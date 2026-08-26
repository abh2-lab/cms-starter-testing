import Redis from 'ioredis';
import { env } from '@cms/config';

/**
 * Worker-side Redis client for cache invalidation. Configured fail-fast
 * (same policy as apps/api/src/lib/cache.ts) so a Dragonfly outage does
 * not stall the worker — invalidation errors are caught and logged by the
 * shared helper in @cms/queue/side-effects.ts.
 *
 * Separate from the BullMQ Redis clients in this process: BullMQ needs
 * `maxRetriesPerRequest: null` for blocking commands; the cache client
 * wants the opposite. Two clients to one Dragonfly is harmless.
 */
export const cacheRedis = new Redis(env.REDIS_URL, {
  // Eager connect so the first cache invalidation doesn't lose its command
  // to enableOfflineQueue:false. Matches apps/api/src/lib/cache.ts.
  lazyConnect: false,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

cacheRedis.on('error', (err: Error) => {
  console.warn('[worker:cache] redis error:', err.message);
});

export async function closeCacheRedis(): Promise<void> {
  try {
    await cacheRedis.quit();
  } catch {
    // ignore — already closed or never opened
  }
}
