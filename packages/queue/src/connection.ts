import Redis, { type RedisOptions } from 'ioredis';
import { env } from '@cms/config';

/**
 * BullMQ requires its Redis connection to have `maxRetriesPerRequest: null`
 * and `enableReadyCheck: false` — otherwise blocking commands (BRPOPLPUSH,
 * BLMOVE) throw and the worker loop breaks. These settings are *wrong* for the
 * fail-fast cache client in apps/api/src/lib/cache.ts, which deliberately
 * times out fast on Dragonfly outages. They are therefore **not** shared.
 *
 * The API process ends up with two Redis clients (cache + queue producer).
 * Dragonfly handles this trivially — its connection ceiling is in the
 * thousands. Do not "deduplicate" them.
 *
 * `lazyConnect: true` means importing this module does not open a socket,
 * which keeps unit-test setup cheap and avoids surprising connection logs
 * during process boot before the producers are first used.
 */
export function createQueueRedis(overrides: RedisOptions = {}): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    ...overrides,
  });
}
