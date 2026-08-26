import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

const CreateBody = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string().min(1)).min(1),
  expiresAt: z.string().datetime().nullable().optional(),
});

const IdParam = z.object({ id: z.string().uuid() });

const ListQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// api_keys.tenant_id is NOT NULL — a global admin has no keys to manage.
function tenantOf(request: FastifyRequest, reply: FastifyReply): string | null {
  const session = getSession(request);
  if (session.user.tenantId === null) {
    reply.code(400).send({ error: 'API keys require a tenant context' });
    return null;
  }
  return session.user.tenantId;
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Columns safe to return — never the key hash.
const publicColumns = {
  id: schema.apiKeys.id,
  name: schema.apiKeys.name,
  scopes: schema.apiKeys.scopes,
  lastUsedAt: schema.apiKeys.lastUsedAt,
  expiresAt: schema.apiKeys.expiresAt,
  revokedAt: schema.apiKeys.revokedAt,
  createdBy: schema.apiKeys.createdBy,
  createdAt: schema.apiKeys.createdAt,
  updatedAt: schema.apiKeys.updatedAt,
};

export const adminApiKeysRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  fastify.get('/', async (request, reply) => {
    const query = ListQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        error: 'Invalid query',
        issues: query.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const tenantId = tenantOf(request, reply);
    if (tenantId === null) return reply;
    const session = getSession(request);
    const conditions: (SQL | undefined)[] = [
      tenantFilter(session.user, schema.apiKeys.tenantId),
    ];
    if (query.data.cursor) {
      conditions.push(lt(schema.apiKeys.id, query.data.cursor));
    }
    const rows = await db
      .select(publicColumns)
      .from(schema.apiKeys)
      .where(and(...conditions))
      .orderBy(desc(schema.apiKeys.id))
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

  // Create — returns the raw key exactly once; only its hash is stored.
  fastify.post(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const parsed = CreateBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid request body',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);

      const rawKey = `cms_${randomBytes(32).toString('base64url')}`;
      const [row] = await db
        .insert(schema.apiKeys)
        .values({
          tenantId,
          name: parsed.data.name,
          keyHash: hashKey(rawKey),
          scopes: parsed.data.scopes,
          expiresAt: parsed.data.expiresAt
            ? new Date(parsed.data.expiresAt)
            : null,
          createdBy: session.user.id,
        })
        .returning(publicColumns);
      // The raw key is shown once and never recoverable afterwards.
      return reply.code(201).send({ data: { ...row, key: rawKey } });
    },
  );

  // Revoke (soft) — sets revoked_at; the key stops authenticating.
  fastify.post(
    '/:id/revoke',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);
      const [row] = await db
        .update(schema.apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.apiKeys.id, params.data.id),
            tenantFilter(session.user, schema.apiKeys.tenantId),
          ),
        )
        .returning(publicColumns);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      return { data: row };
    },
  );
};
