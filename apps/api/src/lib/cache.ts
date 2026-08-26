import Redis from 'ioredis';
import type { FastifyReply } from 'fastify';
import { env } from '@cms/config';

// 5 minutes. The Phase 6 schedule-publish worker invalidates these keys
// when it auto-publishes a row, so scheduled posts become visible
// within seconds of their publishAt rather than waiting out the TTL.
export const PUBLIC_CACHE_TTL_SECONDS = 300;

// One Redis client per process. Configured so a Dragonfly outage degrades to
// direct DB rather than hanging — every public route is wrapped in withCache
// which falls back to the loader on any Redis error.
const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

redis.on('error', (err: Error) => {
  console.warn('[cache] redis error:', err.message);
});

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    // ignore — process is exiting
  }
}

/**
 * In-flight loader promises, keyed by cache key. On a miss the FIRST caller
 * starts a loader and publishes its promise here; concurrent callers for the
 * same key await the SAME promise instead of firing a duplicate backend hit.
 * The slot is cleared in a `finally` when the promise settles so the next
 * genuine miss (after the TTL or an explicit invalidation) can fetch again.
 *
 * Without this guard, a 50-request burst at a freshly-evicted key fans out to
 * 50 concurrent DB queries — a thundering herd that is particularly damaging
 * for the composed-page endpoint, where each loader itself fans out to N
 * block resolvers. See cache.test.ts for the contract assertions.
 *
 * Module-scope (one Map per process) is correct because each process has its
 * own Redis client and its own cache misses; cross-process single-flight is
 * Redis's job, not ours.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Cache a logical response shape. On Redis hit, returns the parsed value. On
 * miss OR any Redis error, runs the loader and best-effort writes the result
 * back. Cache must fail open: a Dragonfly outage cannot break reads.
 *
 * Concurrent callers for the same key share a single in-flight loader (see
 * `inFlight` above) so a missed key triggers at most one loader at a time.
 */
export async function withCache<T>(
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  // 1) Try Redis first. A hit short-circuits the in-flight machinery entirely.
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    console.warn('[cache] get failed:', (err as Error).message);
  }

  // 2) Miss. If another caller is already loading this key, await their
  //    promise rather than firing a parallel loader.
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  // 3) First miss for this key — claim the in-flight slot and run the loader.
  //    The IIFE both runs the loader and best-effort writes the result back
  //    to Redis so racing callers see the cached result on their next call.
  const promise = (async (): Promise<T> => {
    const value = await loader();
    // Never cache a negative (null/undefined). The public detail routes
    // (content, pages, menus, taxonomy-terms) all map a null loader result to
    // a 404, so writing null here would pin that 404 for the full TTL —
    // poisoning a slug whose "not found" was only transient. The classic
    // trigger: a row published a moment ago whose `publish_at <= now()` window
    // check fails because the API process clock leads Postgres's (host-run API
    // vs Dockerized PG on a lagging WSL2 clock). Skipping the write lets the
    // very next read re-run the loader and pick the row up the instant it is
    // visible. The single-flight guard above still collapses a concurrent burst
    // of misses — including misses on a genuinely-absent slug — into one DB
    // query, so declining to cache negatives does not open a thundering herd.
    if (value !== null && value !== undefined) {
      try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
      } catch (err) {
        console.warn('[cache] set failed:', (err as Error).message);
      }
    }
    return value;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    // Always clear the slot — whether the loader resolved or rejected — so a
    // future miss after the cache TTL can fetch fresh, and a rejected loader
    // doesn't permanently pin a poisoned promise into the map.
    inFlight.delete(key);
  }
}

export async function invalidateKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.warn('[cache] del failed:', (err as Error).message);
  }
}

/**
 * Best-effort pattern delete using SCAN + UNLINK so we never block Dragonfly
 * with KEYS. Used to invalidate batches like cache:archive:{tenant}:{type}:*.
 */
export async function invalidatePattern(pattern: string): Promise<void> {
  try {
    // ioredis's scanStream yields a string[] chunk per data event, but it
    // types those as `any`. Cast once at the boundary so the rest of the
    // loop stays type-clean.
    const stream = redis.scanStream({
      match: pattern,
      count: 200,
    }) as AsyncIterable<string[]>;
    let batch: string[] = [];
    for await (const keys of stream) {
      if (keys.length === 0) continue;
      batch.push(...keys);
      if (batch.length >= 500) {
        await redis.unlink(...batch);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await redis.unlink(...batch);
    }
  } catch (err) {
    console.warn('[cache] pattern invalidate failed:', (err as Error).message);
  }
}

/**
 * Cache-Control header for public GET responses. Lets a future CDN sit in
 * front of the API and cache identically to our Dragonfly layer.
 */
export function cacheHeaders(reply: FastifyReply): void {
  reply.header(
    'Cache-Control',
    `public, max-age=${PUBLIC_CACHE_TTL_SECONDS}, s-maxage=${PUBLIC_CACHE_TTL_SECONDS}`,
  );
}
