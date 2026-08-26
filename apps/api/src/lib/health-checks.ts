import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import { db } from '@cms/db';
import { env } from '@cms/config';
import { meili } from '@cms/search';
import Redis from 'ioredis';
import { getCurrentBucket, getRawS3Client } from './s3.js';

// Per-dependency probe result. `latencyMs` is wall-clock from start of the
// probe to its result — handy for spotting a slow but healthy dep before it
// becomes a failed one.
export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ReadinessResult {
  ok: boolean;
  checks: {
    db: ProbeResult;
    redis: ProbeResult;
    meili: ProbeResult;
    s3: ProbeResult;
  };
}

// Per-probe timeout. A long-stuck dep can't drag the whole readiness check
// past the orchestrator's probe timeout (typically 5s on Coolify / k8s).
const PROBE_TIMEOUT_MS = 2_000;

// Memoise the result so a thundering herd of probes (k8s `livenessProbe`
// timer drift, multiple LB checks) can't melt the DB pool.
const CACHE_TTL_MS = 5_000;
let cached: { at: number; value: ReadinessResult } | null = null;

// Dedicated Redis client for the PING probe. Kept off the cache client so a
// hung cache socket can't make readiness look unhealthy, and off the queue
// producer client because that one has BullMQ-specific blocking settings.
let healthRedis: Redis | null = null;
function getHealthRedis(): Redis {
  healthRedis ??= new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: PROBE_TIMEOUT_MS,
  });
  return healthRedis;
}

export async function closeHealthRedis(): Promise<void> {
  if (!healthRedis) return;
  try {
    await healthRedis.quit();
  } catch {
    // ignore — process exiting
  }
}

async function withTimeout<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} probe timed out after ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        ),
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run the four readiness probes in parallel. Returns a snapshot of which deps
 * are reachable. Cached in-process for 5s — sufficient to debounce a probing
 * load balancer, short enough that real outages surface promptly.
 *
 * Probes:
 *   db    — `SELECT 1` via drizzle (pool-borrowed connection)
 *   redis — `PING` against Dragonfly on REDIS_URL
 *   meili — Meili's `/health` (which is the SDK's `health()`)
 *   s3    — `HEAD <BUCKET>` against the configured S3 endpoint
 */
export async function runReadinessChecks(): Promise<ReadinessResult> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const [dbProbe, redisProbe, meiliProbe, s3Probe] = await Promise.all([
    withTimeout('db', async () => {
      await db.execute(sql`select 1`);
    }),
    withTimeout('redis', async () => {
      await getHealthRedis().ping();
    }),
    withTimeout('meili', async () => {
      // Meili SDK's health() throws on non-200; sufficient for a probe.
      await meili.health();
    }),
    withTimeout('s3', async () => {
      await getRawS3Client().send(
        new HeadBucketCommand({ Bucket: getCurrentBucket() }),
      );
    }),
  ]);

  const ok = dbProbe.ok && redisProbe.ok && meiliProbe.ok && s3Probe.ok;
  const value: ReadinessResult = {
    ok,
    checks: { db: dbProbe, redis: redisProbe, meili: meiliProbe, s3: s3Probe },
  };
  cached = { at: now, value };
  return value;
}
