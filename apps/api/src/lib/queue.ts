import {
  createProducers,
  createQueueRedis,
  type Producers,
} from '@cms/queue';

/**
 * Single API-process Redis connection used by every BullMQ Queue producer.
 *
 * This is intentionally **separate** from the cache client in ./cache.ts.
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
 * on its connection (see @cms/queue/connection.ts) — the cache client uses
 * the opposite settings on purpose so a Dragonfly outage degrades fast.
 * Sharing one client between the two would mean choosing the wrong policy
 * for at least one of them, so we run two.
 *
 * Lazy connect means importing this module does not open a socket; the
 * connection opens the first time a producer calls `.add()`. This keeps
 * unit-test setup cheap and avoids a noisy boot log when no jobs ever fire.
 */
const queueConnection = createQueueRedis();

/**
 * Singleton producer surface. Routes import { producers } and call e.g.
 * `producers.searchIndex.upsert(id, 'update')`. Always treat enqueue as
 * fire-and-forget — see callsite guidance in apps/api/src/routes/admin/*.
 */
export const producers: Producers = createProducers(queueConnection);

/**
 * Graceful shutdown — called from the onClose hook in src/index.ts. Closes
 * every Queue (which flushes pending pipelined commands) and then quits the
 * underlying Redis connection.
 */
export async function closeQueueProducers(): Promise<void> {
  await producers.close();
  try {
    await queueConnection.quit();
  } catch {
    // ignore — connection may have never opened (lazyConnect) or already closed
  }
}
