import { isNull, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Shape of the bits we read off `session.user`. Anything narrower than the
// full session works — this keeps the helper decoupled from the session
// schema and lets tests pass plain objects.
export interface SessionLike {
  role: string;
  tenantId: string | null;
}

/**
 * Build the WHERE clause for an admin SELECT that's scoped to a tenant.
 *
 *  - `role === 'super_admin'`: returns `undefined`. The caller MUST treat
 *    that as "no filter" — super_admins see the union of every tenant's rows.
 *    This is how a single super_admin login can manage the whole install
 *    even when the schema carries `tenant_id` on every table for the future
 *    SaaS variant.
 *  - `tenantId === null` non-super-admin: matches the `IS NULL` rows
 *    (e.g. global system content_types created by FBE).
 *  - `tenantId === UUID` non-super-admin: matches rows owned by that tenant.
 *
 * Callers that build a SQL[] of conditions should skip `undefined` returns
 * via the small `whereConditions(...)` helper below, or via a manual
 * `if (tf) conditions.push(tf)`.
 */
export function tenantFilter(
  session: SessionLike,
  column: AnyPgColumn,
): SQL | undefined {
  if (session.role === 'super_admin') return undefined;
  if (session.tenantId === null) return isNull(column);
  return eq(column, session.tenantId);
}

/**
 * Pick the `tenant_id` to write on an admin INSERT/UPDATE.
 *
 * Currently a passthrough returning `session.tenantId`. Included as a
 * dedicated seam so:
 *   1. Callers consistently flow through one helper for write-tenant
 *      resolution (parallel to `tenantFilter` for reads).
 *   2. If we ever introduce a "primary tenant" fallback for a global
 *      super_admin with `tenant_id = NULL`, only this function changes.
 *
 * For now, super_admins keep a non-NULL tenant_id (pinned at the canonical
 * tenant after `pnpm --filter @cms/api fold:single-tenant`), so writes
 * route there automatically without any special case.
 */
export function effectiveWriteTenantId(session: SessionLike): string | null {
  return session.tenantId;
}

/**
 * Compact `SQL[]` builder that drops `undefined`s from `tenantFilter`. Lets
 * a route write
 *
 *     const conditions = whereConditions(
 *       tenantFilter(session.user, schema.content.tenantId),
 *       eq(schema.content.status, 'published'),
 *     );
 *     await db.select().from(content).where(and(...conditions));
 *
 * instead of branching on whether the tenant filter exists. When the array
 * is empty after filtering, drizzle's `and()` returns `undefined`, which
 * `.where(undefined)` treats as a no-op — exactly what super_admin wants.
 */
export function whereConditions(
  ...conditions: (SQL | undefined)[]
): SQL[] {
  return conditions.filter((c): c is SQL => c !== undefined);
}
