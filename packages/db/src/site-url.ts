import { eq, isNull } from 'drizzle-orm';
import { db } from './client.js';
import { isUndefinedTableError } from './error-codes.js';
import { siteSettings } from './schema/site-settings.js';

/**
 * Read the public site URL for a tenant from `site_settings.siteUrl`. Returns
 * null when no row exists, the URL is empty, OR the site_settings table itself
 * is missing (post-pull / pre-migrate). The last case logs a one-shot warning;
 * callers treat null uniformly as "not configured" and surface their own UX.
 *
 * This is the uncached primitive — `apps/api` wraps it with a module-scoped
 * cache + explicit invalidation; the worker calls it per-email (rare enough
 * that a per-job DB hit is fine).
 */
export async function readSiteUrl(
  tenantId: string | null,
): Promise<string | null> {
  try {
    const [row] = await db
      .select({ siteUrl: siteSettings.siteUrl })
      .from(siteSettings)
      .where(
        tenantId === null
          ? isNull(siteSettings.tenantId)
          : eq(siteSettings.tenantId, tenantId),
      )
      .limit(1);
    if (!row) return null;
    return row.siteUrl.length > 0 ? row.siteUrl : null;
  } catch (err) {
    if (isUndefinedTableError(err, 'site_settings')) return null;
    throw err;
  }
}
