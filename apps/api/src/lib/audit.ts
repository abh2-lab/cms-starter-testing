import type { FastifyRequest } from 'fastify';
import { lt } from 'drizzle-orm';
import { db, schema } from '@cms/db';

/**
 * How long audit_log rows are kept before the daily retention job deletes
 * them. 30 days is enough to support the dashboard activity feed, common
 * "who edited this last week" debugging, and the 7–14-day editorial review
 * cycle, without growing the table unbounded in single-tenant deployments.
 * Bump this in one place if you need longer history.
 */
export const AUDIT_RETENTION_DAYS = 30;

/**
 * Append-only activity log helper. Every admin mutation that should surface
 * in the dashboard's Recent Activity feed (and the future per-resource audit
 * trail) calls this from inside its handler.
 *
 * Failure policy: catches its own errors and console.error's them. The audit
 * log is never the reason a user-facing mutation fails. The exception is when
 * a caller passes `tx` — then the insert runs inside that transaction and a
 * thrown error will roll the mutation back. That's the right tradeoff for
 * writes where audit drift would be worse than the failed request (the
 * content.updated path uses this, paired with the revision snapshot).
 *
 * The `tx` parameter type is inferred straight from `db.transaction`'s
 * callback signature. Drizzle's tx is structurally a database minus the
 * `$client` property, so it isn't assignable to the exported `Database`
 * alias under strict typing. Pulling the type from the source of truth
 * keeps this helper resilient to drizzle-orm version bumps that may
 * tweak the underlying `PgTransaction<...>` generic.
 */
type DrizzleTx = Parameters<typeof db.transaction>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
export type AuditAction =
  // content
  | 'content.created'
  | 'content.updated'
  | 'content.deleted'
  | 'content.duplicated'
  | 'content.transitioned'
  | 'content.submitted'
  | 'content.preview_token_issued'
  // content types (the schema, not the entries — admin/structure events)
  | 'content_type.created'
  | 'content_type.updated'
  | 'content_type.deleted'
  // taxonomies
  | 'taxonomy.created'
  | 'taxonomy.updated'
  | 'taxonomy.deleted'
  | 'taxonomy_term.created'
  | 'taxonomy_term.updated'
  | 'taxonomy_term.deleted'
  // media
  | 'media.uploaded'
  | 'media.deleted'
  // pages (separate entity from content; see packages/db/src/schema/pages.ts)
  | 'page.created'
  | 'page.updated'
  | 'page.deleted'
  | 'page.transitioned'
  | 'page.duplicated'
  // page templates (admin-saved arrangements; coexist with code-shipped ones)
  | 'page_template.created'
  | 'page_template.deleted'
  // theme overrides (the FSE structure editor — templates/parts)
  | 'theme_override.draft_saved'
  | 'theme_override.draft_discarded'
  | 'theme_override.published'
  | 'theme_override.reset'
  | 'theme_override.revision_restored'
  // cache (Tools → Purge Cache; a maintenance action, deletes no data)
  | 'cache.purged';

export type AuditResourceType =
  | 'content'
  | 'content_type'
  | 'taxonomy'
  | 'taxonomy_term'
  | 'media'
  | 'page'
  | 'page_template'
  | 'theme_override'
  | 'cache';

export interface LogAuditOptions {
  /** Pass when inside db.transaction(); otherwise uses the module-level db. */
  tx?: DrizzleTx;
  tenantId: string | null;
  /** UUID of the admin (or null for system/api_key actors). */
  actorId: string | null;
  actorType?: 'admin' | 'system' | 'api_key';
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  /** Fastify request, if you want ip + user-agent stamped automatically. */
  request?: FastifyRequest;
  metadata?: Record<string, unknown>;
}

function pickIp(request: FastifyRequest | undefined): string | null {
  if (!request) return null;
  // Fastify exposes the client ip via request.ip after trust-proxy resolution.
  const ip = request.ip;
  return typeof ip === 'string' && ip.length > 0 ? ip : null;
}

function pickUserAgent(request: FastifyRequest | undefined): string | null {
  if (!request) return null;
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' && ua.length > 0 ? ua : null;
}

export async function logAudit(opts: LogAuditOptions): Promise<void> {
  const conn = opts.tx ?? db;
  const insertValues = {
    tenantId: opts.tenantId,
    actorId: opts.actorId,
    actorType: opts.actorType ?? 'admin',
    action: opts.action,
    resourceType: opts.resourceType,
    resourceId: opts.resourceId,
    beforeSnapshot: opts.beforeSnapshot ?? null,
    afterSnapshot: opts.afterSnapshot ?? null,
    ipAddress: pickIp(opts.request),
    userAgent: pickUserAgent(opts.request),
    metadata: opts.metadata ?? {},
  };

  // When inside a transaction we WANT thrown errors so the transaction rolls
  // back — audit drift inside a wrapped write is the worst outcome. Outside
  // a transaction (best-effort logging) we swallow so we never break the
  // user's request because of an audit-side failure.
  if (opts.tx) {
    await opts.tx.insert(schema.auditLog).values(insertValues);
    return;
  }
  try {
    await conn.insert(schema.auditLog).values(insertValues);
  } catch (e) {
    console.error('[audit] insert failed', {
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Delete audit_log rows older than `daysToKeep` days. Returns the number of
 * rows removed. Idempotent — running it twice in a row is harmless.
 *
 * Driven on a daily interval by `startAuditRetention()` (see audit-retention.ts)
 * and exposed as `pnpm --filter @cms/api audit:prune` for one-off ops use.
 *
 * Implementation note: deriving the cutoff in JS (vs `now() - interval` in
 * SQL) keeps the WHERE clause comparable against the indexed `created_at`
 * column without a function on the column side — Postgres uses the
 * `audit_log_tenant_idx` happily even though it isn't index-leading on
 * created_at, because the planner falls back to a sequential scan with the
 * timestamp filter when the table is small (the expected steady state).
 */
export async function pruneOldAuditLogs(
  daysToKeep: number = AUDIT_RETENTION_DAYS,
): Promise<number> {
  if (!Number.isFinite(daysToKeep) || daysToKeep < 1) {
    throw new Error(
      `pruneOldAuditLogs: daysToKeep must be a positive number, got ${daysToKeep}`,
    );
  }
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(schema.auditLog)
    .where(lt(schema.auditLog.createdAt, cutoff))
    .returning({ id: schema.auditLog.id });
  return deleted.length;
}
