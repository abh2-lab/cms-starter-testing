import type { Worker } from 'bullmq';
import { env } from '@cms/config';
import {
  createProducers,
  createQueueRedis,
  JOB_NAMES,
  QUEUE_NAMES,
} from '@cms/queue';

import { startHealthServer } from './health-server.js';
import { closeCacheRedis } from './lib/redis-cache.js';
import { logger } from './logger.js';
import {
  attachWorkerSentry,
  flushSentry,
  initSentry,
} from './observability/sentry.js';
import { registerEmailSendWorker } from './processors/email-send.js';
import { registerImageProcessWorker } from './processors/image-process.js';
import { registerMaintenanceWorker } from './processors/maintenance.js';
import { registerSchedulePublishWorker } from './processors/schedule-publish.js';
import { registerSearchIndexWorker } from './processors/search-index.js';
import { registerWebhookDeliverWorker } from './processors/webhook-deliver.js';

/**
 * Worker entrypoint.
 *
 * - Opens a producer Redis connection (used by processors to enqueue
 *   follow-up jobs, e.g. schedule-publish → search-index).
 * - Starts a tiny /health + /ready HTTP server for orchestrator probes.
 * - Registers every BullMQ Worker (each owns its own Redis connection so
 *   blocking commands on one queue don't starve another).
 * - Handles SIGTERM/SIGINT by pausing fetch and waiting for in-flight jobs
 *   to finish before exiting. A 30s hard-kill prevents stuck shutdowns.
 *
 * New queues are added incrementally — each processor file exports a
 * `register*Worker(connection, deps)` factory that returns a Worker, and we
 * push the result onto `workers` below. Step 1 (this commit) registers zero;
 * the process boots, /health returns 200, and we move on to Bull Board.
 */
async function main(): Promise<void> {
  // Init before any logging — uncaught boot errors should make it to Sentry
  // too. No-op when SENTRY_DSN is empty.
  initSentry();

  logger.info({ port: env.WORKER_PORT }, 'starting worker');

  // Producer connection — shared across all Queue instances. Lazy connect
  // means the socket only opens on first .add() call, which is what we want
  // for processors that enqueue follow-ups.
  const producerConnection = createQueueRedis();
  const producers = createProducers(producerConnection);

  // List of registered workers. Each step in Phase 6 appends one. Each
  // BullMQ Worker owns its own Redis connection (for blocking commands) so
  // a stalled queue doesn't starve the others.
  const emailHandle = registerEmailSendWorker(createQueueRedis(), logger);
  const workers: Worker[] = [
    registerSearchIndexWorker(createQueueRedis(), logger),
    registerWebhookDeliverWorker(createQueueRedis(), logger),
    registerSchedulePublishWorker(createQueueRedis(), producers, logger),
    registerImageProcessWorker(createQueueRedis(), producers, logger),
    registerMaintenanceWorker(createQueueRedis(), producers, logger),
    emailHandle.worker,
  ];
  // Wire each worker's `failed` event into Sentry. Additive — the per-worker
  // `log.warn('job failed', ...)` inside processors stays. No-op when DSN unset.
  for (const w of workers) attachWorkerSentry(w);

  // Repeatable jobs — registered idempotently every boot. BullMQ stores the
  // repeat schedule in Redis keyed by the jobId+repeatOpts; re-adding the
  // same schedule on next boot is a no-op.
  // Pull the underlying maintenance queue via the producer's rawQueues so
  // we can call .add() with repeat options (the typed producers surface
  // doesn't expose repeatable adds — they're a one-off registration).
  const maintenanceQueue = producers.rawQueues.find(
    (q) => q.name === QUEUE_NAMES.maintenance,
  );
  if (maintenanceQueue) {
    // Sweep every 60 minutes. Cheap when nothing is due (two indexed
    // SELECTs); deduplicates against per-row jobs via deterministic jobIds.
    await maintenanceQueue.add(
      JOB_NAMES.maintenance.schedulePublishSweep,
      {},
      {
        repeat: { every: 60 * 60 * 1_000 },
        jobId: 'repeat-scheduled-publish-sweep',
      },
    );
    // Daily Meili drift sweep at 03:15 UTC. Checksum-based skip means
    // a no-op night is one keyset scan with zero Meili writes.
    await maintenanceQueue.add(
      JOB_NAMES.maintenance.meiliDriftSweep,
      {},
      {
        repeat: { pattern: '15 3 * * *', tz: 'UTC' },
        jobId: 'repeat-meili-drift-sweep',
      },
    );
    // Daily release-manifest check at 04:20 UTC — deliberately off the hour
    // and offset from the Meili sweep so every install in the fleet doesn't
    // hit the release host in the same second. One outbound GET; a no-op when
    // UPDATE_CHECK_ENABLED=false or the operator disabled it in the admin.
    await maintenanceQueue.add(
      JOB_NAMES.maintenance.updateCheck,
      {},
      {
        repeat: { pattern: '20 4 * * *', tz: 'UTC' },
        jobId: 'repeat-update-check',
      },
    );
  }

  // Start the health server *after* workers are constructed but *before* we
  // flip /ready — that way orchestrators that probe immediately don't get
  // routed traffic until every worker has attached.
  const health = await startHealthServer(env.WORKER_PORT, logger);

  // No workers yet → ready as soon as the health server is listening.
  // Once processors are registered we'll wait on each worker.waitUntilReady().
  await Promise.all(workers.map((w) => w.waitUntilReady()));
  health.setReady(true);
  logger.info({ workers: workers.length }, 'worker ready');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    health.setReady(false);

    // Hard-kill watchdog. Coolify's default stop timeout is 10s; we ask for
    // 45s and finish gracefully within ~30s on a healthy run. The unref()
    // prevents this timer from holding the event loop open if we're already
    // done cleanly.
    const kill = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 30_000);
    kill.unref();

    // Worker.close() stops fetching new jobs and waits for active ones.
    await Promise.allSettled(workers.map((w) => w.close()));
    await emailHandle.closeTransport().catch(() => {
      // ignore — transport already closed or never opened a pool
    });
    await producers.close();
    await producerConnection.quit().catch(() => {
      // ignore — already closed or never connected
    });
    await closeCacheRedis();
    await health.close();
    // Flush any buffered Sentry events before exit. 2s cap so a slow
    // Glitchtip can't extend shutdown past Coolify's grace period.
    await flushSentry(2_000);
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  // Don't kill the worker on uncaught exceptions from a single job — BullMQ
  // already catches processor throws. But surface them loudly.
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

void main().catch((err: unknown) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
