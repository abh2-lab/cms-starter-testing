import { and, eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { db, schema } from '@cms/db';

import type { Producers } from './producer.js';

/**
 * Minimal logger shape — matches FastifyBaseLogger AND pino's Logger so both
 * the API and the worker can pass their native logger through without
 * adapter glue.
 */
export interface SideEffectsLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
}

/**
 * Build the public-cache key for a single content row. Mirrors the key
 * format used by withCache() in apps/api/src/lib/cache.ts — keep in sync if
 * that ever changes.
 */
export function contentCacheKey(
  tenantId: string,
  contentTypeSlug: string,
  contentSlug: string,
): string {
  return `cache:content:${tenantId}:${contentTypeSlug}:${contentSlug}`;
}

export function archiveCachePattern(
  tenantId: string,
  contentTypeSlug: string,
): string {
  return `cache:archive:${tenantId}:${contentTypeSlug}:*`;
}

/**
 * Drop the cache entries for one content row. Best-effort:
 *   - tenantId === null: noop (global/system content has no cache)
 *   - contentType row missing: noop (route was deleted concurrently)
 *   - Redis error: caller's `log.warn` then return
 *
 * Worker-callable: pass any Redis client. Uses SCAN+UNLINK for the archive
 * pattern so a long key list never blocks Dragonfly.
 */
export async function invalidateContentCache(args: {
  redis: Redis;
  log: SideEffectsLogger;
  tenantId: string | null;
  contentTypeId: string;
  contentSlug: string;
}): Promise<void> {
  const { redis, log, tenantId, contentTypeId, contentSlug } = args;
  if (!tenantId) return;
  try {
    const [typeRow] = await db
      .select({ slug: schema.contentTypes.slug })
      .from(schema.contentTypes)
      .where(eq(schema.contentTypes.id, contentTypeId))
      .limit(1);
    if (!typeRow) return;

    const key = contentCacheKey(tenantId, typeRow.slug, contentSlug);
    await redis.del(key);

    const pattern = archiveCachePattern(tenantId, typeRow.slug);
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
    log.warn(
      { err, contentTypeId, contentSlug, tenantId },
      'public cache invalidation failed',
    );
  }
}

/**
 * Find every active webhook in this tenant subscribed to `eventName` and
 * enqueue one delivery job per match. Fire-and-forget at the call site: the
 * SELECT is awaited but the enqueues are detached. Errors are logged, not
 * rethrown — webhook firing must never block the upstream write.
 *
 * Used by both the API (post-mutation hooks in content/media routes) and
 * the worker (scheduled-publish processor needs to fire content.published
 * when it auto-publishes).
 */
export async function dispatchEvent(args: {
  producers: Producers;
  log: SideEffectsLogger;
  eventName: string;
  payload: Record<string, unknown>;
  tenantId: string | null;
  /** API's Fastify request id, when called from an HTTP handler — flows into
   * each enqueued WebhookDeliver job so worker logs grep alongside the API. */
  reqId?: string;
}): Promise<void> {
  const { producers, log, eventName, payload, tenantId, reqId } = args;
  if (tenantId === null) return; // webhooks.tenant_id NOT NULL — no subscribers
  try {
    const matches = await db
      .select({ id: schema.webhooks.id })
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.tenantId, tenantId),
          eq(schema.webhooks.isActive, true),
          // Postgres @> on text[] with the GIN index defined on webhooks.events.
          sql`${schema.webhooks.events} @> ARRAY[${eventName}]::text[]`,
        ),
      );
    if (matches.length === 0) return;
    for (const m of matches) {
      void producers.webhooks
        .deliver({
          webhookId: m.id,
          eventName,
          payload,
          ...(reqId !== undefined ? { reqId } : {}),
        })
        .catch((err: unknown) => {
          log.warn(
            { err, webhookId: m.id, eventName },
            'enqueue webhook-deliver failed',
          );
        });
    }
  } catch (err) {
    log.warn({ err, eventName }, 'webhook dispatch lookup failed');
  }
}
