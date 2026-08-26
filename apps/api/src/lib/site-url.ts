import { readSiteUrl } from '@cms/db';

// Per-tenant cache so /admin/auth/me and Preview-button clicks don't hit the
// DB on every call. Cleared explicitly by the site-settings PUT handler so an
// admin edit is reflected on the next read without restarting the API. A
// missing siteUrl is cached as null to avoid hammering the DB after a
// misconfiguration — the next PATCH invalidates the entry anyway.
const cache = new Map<string, string | null>();
const NULL_TENANT_KEY = '__null__';

function cacheKey(tenantId: string | null): string {
  return tenantId ?? NULL_TENANT_KEY;
}

/**
 * The public site URL for a tenant — drives Preview buttons, /admin/auth/me's
 * `publicWebUrl` field, and any admin → public link construction. Returns
 * null when `site_settings.siteUrl` is unset; callers surface a clean
 * "set Site URL in Site Settings" error rather than constructing a broken URL.
 */
export async function resolveSiteUrl(
  tenantId: string | null,
): Promise<string | null> {
  const key = cacheKey(tenantId);
  if (cache.has(key)) return cache.get(key) ?? null;
  const value = await readSiteUrl(tenantId);
  cache.set(key, value);
  return value;
}

/** Drop the cached siteUrl for a tenant; call from the site-settings PUT. */
export function invalidateSiteUrlCache(tenantId: string | null): void {
  cache.delete(cacheKey(tenantId));
}
