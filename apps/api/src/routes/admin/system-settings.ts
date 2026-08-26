import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

type SystemSettings = typeof schema.systemSettings.$inferSelect;
type NewSystemSettings = typeof schema.systemSettings.$inferInsert;

const PatchBody = z.object({
  rateLimitMax: z.coerce.number().int().min(1).max(100_000).optional(),
  rateLimitWindowValue: z.coerce.number().int().min(1).max(86_400).optional(),
  rateLimitWindowUnit: z.enum(['second', 'minute']).optional(),
  workerImageConcurrency: z.coerce.number().int().min(1).max(32).optional(),
  workerWebhookConcurrency: z.coerce.number().int().min(1).max(64).optional(),
  workerSearchIndexConcurrency: z.coerce.number().int().min(1).max(32).optional(),
  workerSchedulePublishConcurrency: z.coerce.number().int().min(1).max(16).optional(),
  workerEmailConcurrency: z.coerce.number().int().min(1).max(16).optional(),
});

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// Tenant filter moved to ../../lib/tenant-scope.ts (tenantFilter) so
// super_admin bypasses scoping automatically.

function sendZodError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: 'Invalid request body',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  });
}

function toView(row: SystemSettings) {
  return {
    rateLimitMax: row.rateLimitMax,
    rateLimitWindowValue: row.rateLimitWindowValue,
    rateLimitWindowUnit: row.rateLimitWindowUnit,
    workerImageConcurrency: row.workerImageConcurrency,
    workerWebhookConcurrency: row.workerWebhookConcurrency,
    workerSearchIndexConcurrency: row.workerSearchIndexConcurrency,
    workerSchedulePublishConcurrency: row.workerSchedulePublishConcurrency,
    workerEmailConcurrency: row.workerEmailConcurrency,
  };
}

const DEFAULTS = {
  rateLimitMax: 100,
  rateLimitWindowValue: 1,
  rateLimitWindowUnit: 'minute' as const,
  workerImageConcurrency: 2,
  workerWebhookConcurrency: 16,
  workerSearchIndexConcurrency: 8,
  workerSchedulePublishConcurrency: 4,
  workerEmailConcurrency: 4,
};

export const adminSystemSettingsRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  fastify.addHook('preHandler', requireAdminAuth);

  fastify.get(
    '/',
    { preHandler: requireAdminRole('super_admin') },
    async (request) => {
      const session = getSession(request);
      const [row] = await db
        .select()
        .from(schema.systemSettings)
        .where(tenantFilter(session.user, schema.systemSettings.tenantId))
        .limit(1);
      return { data: row ? toView(row) : DEFAULTS };
    },
  );

  fastify.patch(
    '/',
    { preHandler: requireAdminRole('super_admin') },
    async (request, reply) => {
      const parsed = PatchBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const session = getSession(request);
      const data = parsed.data;

      const patch: Partial<NewSystemSettings> = {};
      if (data.rateLimitMax !== undefined) patch.rateLimitMax = data.rateLimitMax;
      if (data.rateLimitWindowValue !== undefined)
        patch.rateLimitWindowValue = data.rateLimitWindowValue;
      if (data.rateLimitWindowUnit !== undefined)
        patch.rateLimitWindowUnit = data.rateLimitWindowUnit;
      if (data.workerImageConcurrency !== undefined)
        patch.workerImageConcurrency = data.workerImageConcurrency;
      if (data.workerWebhookConcurrency !== undefined)
        patch.workerWebhookConcurrency = data.workerWebhookConcurrency;
      if (data.workerSearchIndexConcurrency !== undefined)
        patch.workerSearchIndexConcurrency = data.workerSearchIndexConcurrency;
      if (data.workerSchedulePublishConcurrency !== undefined)
        patch.workerSchedulePublishConcurrency = data.workerSchedulePublishConcurrency;
      if (data.workerEmailConcurrency !== undefined)
        patch.workerEmailConcurrency = data.workerEmailConcurrency;

      const [existing] = await db
        .select({ id: schema.systemSettings.id })
        .from(schema.systemSettings)
        .where(tenantFilter(session.user, schema.systemSettings.tenantId))
        .limit(1);

      let row: SystemSettings | undefined;
      if (existing) {
        [row] = await db
          .update(schema.systemSettings)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(schema.systemSettings.id, existing.id))
          .returning();
      } else {
        [row] = await db
          .insert(schema.systemSettings)
          .values({ ...patch, tenantId: session.user.tenantId })
          .returning();
      }
      if (!row) throw new Error('system_settings upsert returned no row');
      // Rate-limit + worker concurrency are loaded at process boot; the UI
      // surfaces the "restart to apply" caveat after save.
      return { data: toView(row) };
    },
  );
};
