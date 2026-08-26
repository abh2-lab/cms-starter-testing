import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '@cms/config';
import { db, schema } from '@cms/db';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { checkStorage } from '../../lib/s3.js';

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// Tenant filters moved to ../../lib/tenant-scope.ts (tenantFilter). The
// admin dashboard widgets (counts, activity) feed off `content` and
// `audit_log`; for super_admin both bypass the tenant filter so the
// dashboard reflects the union across every tenant.

async function meilisearchOk(): Promise<boolean> {
  try {
    const res = await fetch(`${env.MEILI_HOST}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// LEFT JOIN admin_users (system/api_key actors have no matching row — an
// INNER JOIN would silently drop them from the feed). Resource joins are
// also LEFT, since audit_log keeps no FK on resourceId by design and the
// referenced row may have been deleted since. The UI handles each null
// case with a fallback (deleted user / System / snapshot title).
//
// Extracted so the dashboard summary endpoint and the paginated /activity
// endpoint query exactly the same shape — divergence would surface as
// "the dashboard says X but the activity page says Y".
// Callers compose the WHERE themselves; Drizzle's .where() is replace, not
// AND, so baking the tenant filter in here would force every caller to
// re-include it or risk losing it when they add their own conditions.
function selectActivityRows() {
  return db
    .select({
      id: schema.auditLog.id,
      actorType: schema.auditLog.actorType,
      actorId: schema.auditLog.actorId,
      actorDisplayName: schema.adminUsers.displayName,
      action: schema.auditLog.action,
      resourceType: schema.auditLog.resourceType,
      resourceId: schema.auditLog.resourceId,
      beforeSnapshot: schema.auditLog.beforeSnapshot,
      afterSnapshot: schema.auditLog.afterSnapshot,
      metadata: schema.auditLog.metadata,
      createdAt: schema.auditLog.createdAt,
      contentTitle: schema.content.title,
      taxonomyName: schema.taxonomies.name,
      mediaFilename: schema.media.originalFilename,
    })
    .from(schema.auditLog)
    .leftJoin(
      schema.adminUsers,
      eq(schema.auditLog.actorId, schema.adminUsers.id),
    )
    .leftJoin(
      schema.content,
      and(
        eq(schema.auditLog.resourceType, 'content'),
        eq(schema.auditLog.resourceId, schema.content.id),
      ),
    )
    .leftJoin(
      schema.taxonomies,
      and(
        eq(schema.auditLog.resourceType, 'taxonomy'),
        eq(schema.auditLog.resourceId, schema.taxonomies.id),
      ),
    )
    .leftJoin(
      schema.media,
      and(
        eq(schema.auditLog.resourceType, 'media'),
        eq(schema.auditLog.resourceId, schema.media.id),
      ),
    );
}

const ActivityListQuery = z.object({
  // Cursor is the id of the last row from the previous page. audit_log.id
  // is uuidv7 (monotonic), so `id < cursor` on desc(createdAt) order gives
  // us the next slice without an OFFSET scan.
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminDashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // Aggregate stats for the dashboard.
  fastify.get('/', async (request) => {
    const session = getSession(request);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const [byStatus, scheduledToday, recentActivity] = await Promise.all([
      db
        .select({
          status: schema.content.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.content)
        .where(tenantFilter(session.user, schema.content.tenantId))
        .groupBy(schema.content.status),
      db
        .select({
          id: schema.content.id,
          title: schema.content.title,
          publishAt: schema.content.publishAt,
        })
        .from(schema.content)
        .where(
          and(
            tenantFilter(session.user, schema.content.tenantId),
            eq(schema.content.status, 'scheduled'),
            gte(schema.content.publishAt, startOfToday),
            lt(schema.content.publishAt, startOfTomorrow),
          ),
        )
        .orderBy(schema.content.publishAt),
      selectActivityRows()
        .where(tenantFilter(session.user, schema.auditLog.tenantId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(10),
    ]);

    return { data: { contentByStatus: byStatus, scheduledToday, recentActivity } };
  });

  // System health panel — admin+ only (counts as privileged operational info).
  fastify.get(
    '/health',
    { preHandler: requireAdminRole('admin') },
    async () => {
      const [meilisearch, storage] = await Promise.all([
        meilisearchOk(),
        checkStorage(),
      ]);
      // BullMQ/queue is not built yet (Phase 6).
      return { data: { meilisearch, storage, queue: 'not_configured' } };
    },
  );

  // GET /activity — paginated activity feed (the dashboard widget shows the
  // top 20; this endpoint backs the full /activity page in the admin app).
  // Cursor-based on uuidv7 id so paging stays O(log n) even when audit_log
  // grows toward the 30-day retention ceiling.
  fastify.get('/activity', async (request, reply) => {
    const query = ActivityListQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        error: 'Invalid query',
        issues: query.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const session = getSession(request);

    // Fetch limit+1 so we can answer hasMore without a second query.
    const conditions: (SQL | undefined)[] = [
      tenantFilter(session.user, schema.auditLog.tenantId),
    ];
    if (query.data.cursor) {
      conditions.push(lt(schema.auditLog.id, query.data.cursor));
    }
    const rows = await selectActivityRows()
      .where(and(...conditions))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(query.data.limit + 1);

    const hasMore = rows.length > query.data.limit;
    const data = hasMore ? rows.slice(0, query.data.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return {
      data,
      pagination: { nextCursor, hasMore, limit: query.data.limit },
    };
  });
};
