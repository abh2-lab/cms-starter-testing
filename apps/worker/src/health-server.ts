import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import Redis from 'ioredis';
import { env } from '@cms/config';
import type { Logger } from './logger.js';

// Dedicated short-timeout Redis client for the readiness PING. Kept off the
// queue producer + worker connections because they have BullMQ-specific
// blocking settings that mask outages from a probe perspective.
const READY_PROBE_TIMEOUT_MS = 1_500;
let readyRedis: Redis | null = null;
function getReadyRedis(): Redis {
  readyRedis ??= new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: READY_PROBE_TIMEOUT_MS,
  });
  return readyRedis;
}

async function pingDragonfly(): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.race([
      getReadyRedis().ping(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`redis ping timed out after ${READY_PROBE_TIMEOUT_MS}ms`)),
          READY_PROBE_TIMEOUT_MS,
        ),
      ),
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Tiny HTTP server exposing /health (liveness) and /ready (readiness) for
 * orchestrator probes. The worker does no other request routing — using
 * Fastify here would be paying for plugins, lifecycle, validation, and a
 * router we never exercise. Node's built-in http is enough.
 *
 * Liveness is "the process is up" — always returns 200 once this server is
 * listening. Readiness flips to 200 only after all BullMQ workers have called
 * waitUntilReady() (set via setReady()), so Coolify won't route work to a
 * worker that hasn't yet attached to Dragonfly.
 */
export interface HealthServer {
  close: () => Promise<void>;
  setReady: (ready: boolean) => void;
}

export function startHealthServer(
  port: number,
  log: Logger,
): Promise<HealthServer> {
  let ready = false;

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? '/';
    if (url === '/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (url === '/ready') {
      // /ready folds two signals:
      //   1. workersReady — flipped true after every BullMQ worker has called
      //      waitUntilReady() (set via setReady)
      //   2. dragonfly reachable — short-timeout PING. BullMQ workers depend
      //      on Dragonfly for everything, so a hung Redis means no jobs run.
      // 503 if either signal is bad; per-signal status is in the body.
      void pingDragonfly().then((probe) => {
        const overall = ready && probe.ok;
        res.statusCode = overall ? 200 : 503;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            status: overall ? 'ready' : 'not-ready',
            checks: {
              workersReady: { ok: ready },
              redis: probe,
            },
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  };

  const server = createServer(handler);

  return new Promise<HealthServer>((resolve, reject) => {
    const onError = (err: Error): void => {
      log.error({ err }, 'health server failed to listen');
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', onError);
      log.info({ port }, 'health server listening');
      resolve({
        setReady: (next) => {
          ready = next;
        },
        close: () =>
          new Promise<void>((res) => {
            // Best-effort close of the probe Redis too — the main producer/
            // worker connections close via their own paths.
            const closeRedis = readyRedis
              ? readyRedis.quit().catch(() => {
                  // ignore — shutting down
                })
              : Promise.resolve();
            server.close(() => {
              void closeRedis.finally(() => res());
            });
          }),
      });
    });
  });
}
