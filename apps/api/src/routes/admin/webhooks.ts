import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { decryptWebhookSecret, encryptWebhookSecret } from '@cms/queue';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

const CreateBody = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url().max(2048),
  events: z.array(z.string().min(1)).default([]),
  isActive: z.boolean().optional().default(true),
});
const UpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().max(2048).optional(),
  events: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
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

// webhooks.tenant_id is NOT NULL.
function tenantOf(request: FastifyRequest, reply: FastifyReply): string | null {
  const session = getSession(request);
  if (session.user.tenantId === null) {
    reply.code(400).send({ error: 'Webhooks require a tenant context' });
    return null;
  }
  return session.user.tenantId;
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

// Public columns — never the secret hash or encrypted secret.
const publicColumns = {
  id: schema.webhooks.id,
  name: schema.webhooks.name,
  url: schema.webhooks.url,
  events: schema.webhooks.events,
  isActive: schema.webhooks.isActive,
  createdAt: schema.webhooks.createdAt,
  updatedAt: schema.webhooks.updatedAt,
};

async function webhookInTenant(
  id: string,
  session: { role: string; tenantId: string | null },
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.webhooks.id })
    .from(schema.webhooks)
    .where(
      and(eq(schema.webhooks.id, id), tenantFilter(session, schema.webhooks.tenantId)),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Generate a fresh signing secret and the storage shape (hash + ciphertext).
 * `secret` is returned to the caller once and never persisted in plaintext.
 */
function generateSigningSecret(): {
  secret: string;
  secretHash: string;
  secretEncrypted: Buffer;
} {
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const secretHash = createHash('sha256').update(secret).digest('hex');
  const secretEncrypted = encryptWebhookSecret(secret);
  return { secret, secretHash, secretEncrypted };
}

export const adminWebhooksRoutes: FastifyPluginAsync = async (fastify) => {
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
      tenantFilter(session.user, schema.webhooks.tenantId),
    ];
    if (query.data.cursor) {
      conditions.push(lt(schema.webhooks.id, query.data.cursor));
    }
    const rows = await db
      .select(publicColumns)
      .from(schema.webhooks)
      .where(and(...conditions))
      .orderBy(desc(schema.webhooks.id))
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

  // Create — returns the signing secret once; the hash AND an AES-256-GCM
  // ciphertext of the raw secret are stored. The hash supports legacy
  // verification flows; the ciphertext is what the worker decrypts to HMAC
  // outgoing deliveries.
  fastify.post(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const parsed = CreateBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;

      const { secret, secretHash, secretEncrypted } = generateSigningSecret();
      const [row] = await db
        .insert(schema.webhooks)
        .values({
          tenantId,
          name: parsed.data.name,
          url: parsed.data.url,
          events: parsed.data.events,
          isActive: parsed.data.isActive,
          secretHash,
          secretEncrypted,
        })
        .returning(publicColumns);
      return reply.code(201).send({ data: { ...row, secret } });
    },
  );

  fastify.patch(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const body = UpdateBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      if (Object.keys(body.data).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);
      const [row] = await db
        .update(schema.webhooks)
        .set({ ...body.data, updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.webhooks.id, params.data.id),
            tenantFilter(session.user, schema.webhooks.tenantId),
          ),
        )
        .returning(publicColumns);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      return { data: row };
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);
      const [deleted] = await db
        .delete(schema.webhooks)
        .where(
          and(
            eq(schema.webhooks.id, params.data.id),
            tenantFilter(session.user, schema.webhooks.tenantId),
          ),
        )
        .returning({ id: schema.webhooks.id });
      if (!deleted) return reply.code(404).send({ error: 'Not found' });
      return reply.code(204).send();
    },
  );

  // Rotate the signing secret. Returns the new secret once; subsequent calls
  // will not surface it. Existing webhook subscribers must be updated.
  // Required for legacy rows whose secret_encrypted column is NULL (created
  // before Phase 6) — until rotated, the worker cannot HMAC their deliveries.
  fastify.post(
    '/:id/rotate-secret',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);

      const { secret, secretHash, secretEncrypted } = generateSigningSecret();
      const [row] = await db
        .update(schema.webhooks)
        .set({ secretHash, secretEncrypted, updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.webhooks.id, params.data.id),
            tenantFilter(session.user, schema.webhooks.tenantId),
          ),
        )
        .returning(publicColumns);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      return { data: { ...row, secret } };
    },
  );

  // Last 10 delivery attempts for a webhook.
  fastify.get('/:id/deliveries', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
    const tenantId = tenantOf(request, reply);
    if (tenantId === null) return reply;
    const session = getSession(request);
    if (!(await webhookInTenant(params.data.id, session.user))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const rows = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, params.data.id))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(10);
    return { data: rows };
  });

  // Sync connectivity test. Sends a ping right now and records the delivery —
  // skips the queue so the editor sees the outcome in their next render.
  // Signs with the real per-webhook secret (decrypting secret_encrypted) so
  // receivers can verify the HMAC against what they configured. Falls back
  // to a one-off random key for legacy rows that haven't been rotated yet.
  fastify.post(
    '/:id/test',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);
      const [hook] = await db
        .select({
          id: schema.webhooks.id,
          url: schema.webhooks.url,
          secretEncrypted: schema.webhooks.secretEncrypted,
        })
        .from(schema.webhooks)
        .where(
          and(
            eq(schema.webhooks.id, params.data.id),
            tenantFilter(session.user, schema.webhooks.tenantId),
          ),
        )
        .limit(1);
      if (!hook) return reply.code(404).send({ error: 'Not found' });

      const payload = { event: 'ping', timestamp: new Date().toISOString() };
      const bodyStr = JSON.stringify(payload);
      const signingKey: Buffer | string = hook.secretEncrypted
        ? decryptWebhookSecret(hook.secretEncrypted)
        : randomBytes(16);
      const signature = createHmac('sha256', signingKey)
        .update(bodyStr)
        .digest('hex');

      let status: number | null = null;
      let respBody: string | null;
      let ok = false;
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CMS-Event': 'ping',
            'X-CMS-Signature': `sha256=${signature}`,
          },
          body: bodyStr,
          signal: AbortSignal.timeout(5000),
        });
        status = res.status;
        respBody = (await res.text()).slice(0, 2000);
        ok = res.ok;
      } catch (e) {
        respBody = e instanceof Error ? e.message : 'request failed';
      }

      await db.insert(schema.webhookDeliveries).values({
        webhookId: hook.id,
        eventName: 'ping',
        payload,
        attemptNumber: 1,
        responseStatus: status,
        responseBody: respBody,
        deliveredAt: ok ? new Date() : null,
        failedAt: ok ? null : new Date(),
      });

      return { data: { ok, status, body: respBody?.slice(0, 500) ?? null } };
    },
  );
};
