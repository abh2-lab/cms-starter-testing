import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, lt, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { isSelfRedirect } from '../../lib/redirect-guards.js';

// ─── Validation schemas ────────────────────────────────────────────────────

const PathSchema = z.string().min(1).max(2048);
const RedirectTypeSchema = z.union([z.literal(301), z.literal(302)]);

const CreateRedirectBody = z.object({
  fromPath: PathSchema,
  toPath: PathSchema,
  redirectType: RedirectTypeSchema.optional().default(301),
  isActive: z.boolean().optional().default(true),
  notes: z.string().max(1000).nullable().optional(),
});

const UpdateRedirectBody = CreateRedirectBody.partial();

const ListQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  isActive: z.coerce.boolean().optional(),
});

const IdParam = z.object({ id: z.string().uuid() });

// ─── Helpers ───────────────────────────────────────────────────────────────

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// Tenant filter moved to ../../lib/tenant-scope.ts (tenantFilter) so
// super_admin bypasses scoping automatically.

function isFromPathConflict(e: unknown): boolean {
  return (
    e instanceof Error && e.message.includes('redirects_tenant_from_path_uniq')
  );
}

function sendZodError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: 'Invalid request body',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  });
}

// True when an active redirect already maps to_path→from_path (the reverse of
// the candidate), which would form an A→B / B→A loop. excludeId skips the row
// being updated.
async function hasReverseRedirect(
  session: { role: string; tenantId: string | null },
  fromPath: string,
  toPath: string,
  excludeId?: string,
): Promise<boolean> {
  const conditions: (SQL | undefined)[] = [
    tenantFilter(session, schema.redirects.tenantId),
    eq(schema.redirects.fromPath, toPath),
    eq(schema.redirects.toPath, fromPath),
    eq(schema.redirects.isActive, true),
  ];
  if (excludeId) conditions.push(ne(schema.redirects.id, excludeId));
  const [row] = await db
    .select({ id: schema.redirects.id })
    .from(schema.redirects)
    .where(and(...conditions))
    .limit(1);
  return row !== undefined;
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const adminRedirectsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  fastify.get('/', async (request, reply) => {
    const query = ListQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'Invalid query' });
    }
    const session = getSession(request);
    const conditions: (SQL | undefined)[] = [tenantFilter(session.user, schema.redirects.tenantId)];
    if (query.data.isActive !== undefined) {
      conditions.push(eq(schema.redirects.isActive, query.data.isActive));
    }
    if (query.data.cursor) {
      conditions.push(lt(schema.redirects.id, query.data.cursor));
    }
    const rows = await db
      .select()
      .from(schema.redirects)
      .where(and(...conditions))
      .orderBy(desc(schema.redirects.id))
      .limit(query.data.limit + 1);
    const hasMore = rows.length > query.data.limit;
    const data = hasMore ? rows.slice(0, query.data.limit) : rows;
    const last = data[data.length - 1];
    return {
      data,
      pagination: {
        nextCursor: hasMore && last ? last.id : null,
        hasMore,
        limit: query.data.limit,
      },
    };
  });

  fastify.post(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const parsed = CreateRedirectBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const session = getSession(request);
      if (isSelfRedirect(parsed.data.fromPath, parsed.data.toPath)) {
        return reply
          .code(400)
          .send({ error: 'A redirect cannot point to itself' });
      }
      if (
        await hasReverseRedirect(
          session.user,
          parsed.data.fromPath,
          parsed.data.toPath,
        )
      ) {
        return reply
          .code(400)
          .send({ error: 'That would create a redirect loop (A→B and B→A)' });
      }
      try {
        const [row] = await db
          .insert(schema.redirects)
          .values({ ...parsed.data, tenantId: session.user.tenantId })
          .returning();
        return reply.code(201).send({ data: row });
      } catch (e: unknown) {
        if (isFromPathConflict(e)) {
          return reply
            .code(409)
            .send({ error: 'A redirect for this from-path already exists' });
        }
        throw e;
      }
    },
  );

  fastify.patch(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const body = UpdateRedirectBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      if (Object.keys(body.data).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }
      const session = getSession(request);

      // Load the current row so the guards run against the post-patch state.
      const [current] = await db
        .select({
          fromPath: schema.redirects.fromPath,
          toPath: schema.redirects.toPath,
        })
        .from(schema.redirects)
        .where(
          and(
            eq(schema.redirects.id, params.data.id),
            tenantFilter(session.user, schema.redirects.tenantId),
          ),
        )
        .limit(1);
      if (!current) return reply.code(404).send({ error: 'Not found' });

      const nextFrom = body.data.fromPath ?? current.fromPath;
      const nextTo = body.data.toPath ?? current.toPath;
      if (isSelfRedirect(nextFrom, nextTo)) {
        return reply
          .code(400)
          .send({ error: 'A redirect cannot point to itself' });
      }
      if (
        await hasReverseRedirect(
          session.user,
          nextFrom,
          nextTo,
          params.data.id,
        )
      ) {
        return reply
          .code(400)
          .send({ error: 'That would create a redirect loop (A→B and B→A)' });
      }

      try {
        const [row] = await db
          .update(schema.redirects)
          .set({ ...body.data, updatedAt: sql`now()` })
          .where(
            and(
              eq(schema.redirects.id, params.data.id),
              tenantFilter(session.user, schema.redirects.tenantId),
            ),
          )
          .returning();
        if (!row) return reply.code(404).send({ error: 'Not found' });
        return { data: row };
      } catch (e: unknown) {
        if (isFromPathConflict(e)) {
          return reply
            .code(409)
            .send({ error: 'A redirect for this from-path already exists' });
        }
        throw e;
      }
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const session = getSession(request);
      const [deleted] = await db
        .delete(schema.redirects)
        .where(
          and(
            eq(schema.redirects.id, params.data.id),
            tenantFilter(session.user, schema.redirects.tenantId),
          ),
        )
        .returning({ id: schema.redirects.id });
      if (!deleted) return reply.code(404).send({ error: 'Not found' });
      return reply.code(204).send();
    },
  );
};
