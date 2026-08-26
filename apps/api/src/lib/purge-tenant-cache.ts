import type { FastifyBaseLogger } from 'fastify';
import { invalidatePattern } from './cache.js';
import { purgeWebCache, type WebPurgeResult } from './purge-web-cache.js';

/**
 * Every `cache:` namespace the public API writes. Keys are all shaped
 * `cache:<namespace>:<tenantId>[:...]`, so a full per-tenant purge is one
 * SCAN+UNLINK pass per namespace with the pattern `cache:<ns>:<tenantId>*`.
 *
 * The trailing `*` (note: no colon before it) is deliberate — it matches BOTH
 * the sub-keyed namespaces (e.g. `cache:content:<t>:stories:my-slug`) AND the
 * single terminal key `cache:site-settings:<t>`. Tenant ids are UUIDs, so one
 * tenant's id can never be a prefix of another's — there is no cross-tenant
 * bleed.
 *
 * Keep this list in sync with the withCache() key builders in
 * apps/api/src/routes/public/*.ts. If you add a new cached public route, add
 * its namespace here so "Clear everything" stays complete.
 */
export const CACHE_NAMESPACES = [
  'content',
  'archive',
  'page',
  'resolve',
  'menu',
  'part',
  'view:archive',
  'view:system',
  'site-settings',
  'taxonomy-term',
  'search',
] as const;

/**
 * Clear every public cache for one tenant: all Redis `cache:` namespaces above
 * plus the web app's Nitro SWR HTML cache. Fail-open throughout — a cache purge
 * must never throw back to the caller. The Redis sweep always runs (the cleared
 * namespaces are the exported CACHE_NAMESPACES); the RETURN value is the
 * web-purge outcome, so the caller can tell the operator WHY the public site did
 * not change (e.g. the PURGE_SECRET handshake isn't wired up in production). A
 * null `tenantId` is a defensive no-op — the route guards it out first.
 */
export async function purgeTenantCache(
  log: FastifyBaseLogger,
  tenantId: string | null,
): Promise<WebPurgeResult> {
  if (!tenantId) return { ok: false, reason: 'no_site_url' };
  for (const ns of CACHE_NAMESPACES) {
    await invalidatePattern(`cache:${ns}:${tenantId}*`);
  }
  return purgeWebCache(log, tenantId);
}

/**
 * Clear the caches touched by one content type: its detail rows
 * (`cache:content:<t>:<slug>:*`) and its listings (`cache:archive:<t>:<slug>:*`),
 * plus the web HTML. Mirrors invalidatePublicContentCache() in
 * routes/admin/content.ts. Fail-open; returns the web-purge outcome; null
 * `tenantId` is a defensive no-op.
 */
export async function purgeContentTypeCache(
  log: FastifyBaseLogger,
  tenantId: string | null,
  typeSlug: string,
): Promise<WebPurgeResult> {
  if (!tenantId) return { ok: false, reason: 'no_site_url' };
  await invalidatePattern(`cache:content:${tenantId}:${typeSlug}:*`);
  await invalidatePattern(`cache:archive:${tenantId}:${typeSlug}:*`);
  return purgeWebCache(log, tenantId);
}
