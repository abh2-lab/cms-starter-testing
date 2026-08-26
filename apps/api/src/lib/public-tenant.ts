import { and, eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { env } from '@cms/config';

// Memoized for the process lifetime — the public tenant doesn't change at
// runtime. A failed lookup leaves the cache empty so a later request retries
// (e.g. once the tenant row is created), no restart needed.
let cachedTenantId: string | null = null;

/**
 * The tenant that anonymous public routes (/api/public/*) serve. Admin routes
 * read the tenant from the session; the public surface has no session, so it
 * resolves env.PUBLIC_TENANT_SLUG → tenant id. Throws on a slug that matches no
 * active tenant — a deployment misconfiguration we want surfaced loudly.
 */
export async function resolvePublicTenantId(): Promise<string> {
  if (cachedTenantId !== null) return cachedTenantId;

  const [row] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(
      and(
        eq(schema.tenants.slug, env.PUBLIC_TENANT_SLUG),
        eq(schema.tenants.isActive, true),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error(
      `PUBLIC_TENANT_SLUG="${env.PUBLIC_TENANT_SLUG}" matches no active tenant`,
    );
  }

  cachedTenantId = row.id;
  return cachedTenantId;
}
