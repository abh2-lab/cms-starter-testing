import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { encryptWebhookSecret } from '@cms/queue';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

type MonitoringSettings = typeof schema.monitoringSettings.$inferSelect;
type NewMonitoringSettings = typeof schema.monitoringSettings.$inferInsert;

const MASK = '••••••••';

const PatchBody = z.object({
  // Mask-aware secret: MASK = no change, '' = clear, anything else = encrypt.
  sentryDsn: z.string().max(2048).optional(),
  environment: z.string().max(64).nullable().optional(),
  releaseTag: z.string().max(255).nullable().optional(),
  // 0-100 in the UI; stored as int.
  tracesSampleRate: z.coerce.number().int().min(0).max(100).optional(),
  captureUnhandledErrors: z.boolean().optional(),
  includeUserContext: z.boolean().optional(),
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

function isConfigured(row: MonitoringSettings): boolean {
  return Boolean(
    row.sentryDsnEncrypted && row.sentryDsnEncrypted.length > 0,
  );
}

function partialConfig(row: MonitoringSettings): boolean {
  // DSN is set but environment isn't — surfaces a "Partial" chip + info banner.
  return (
    isConfigured(row) && (!row.environment || row.environment.length === 0)
  );
}

function toMasked(row: MonitoringSettings) {
  return {
    sentryDsn: row.sentryDsnEncrypted ? MASK : '',
    environment: row.environment ?? '',
    releaseTag: row.releaseTag ?? '',
    tracesSampleRate: row.tracesSampleRate,
    captureUnhandledErrors: row.captureUnhandledErrors,
    includeUserContext: row.includeUserContext,
    isConfigured: isConfigured(row),
    isPartial: partialConfig(row),
  };
}

const DEFAULTS = {
  sentryDsn: '',
  environment: '',
  releaseTag: '',
  tracesSampleRate: 0,
  captureUnhandledErrors: true,
  includeUserContext: false,
  isConfigured: false,
  isPartial: false,
};

function applySecret(
  patch: Partial<NewMonitoringSettings>,
  value: string | undefined,
) {
  if (value === undefined || value === MASK) return;
  patch.sentryDsnEncrypted =
    value === '' ? null : encryptWebhookSecret(value);
}

export const adminMonitoringSettingsRoutes: FastifyPluginAsync = async (
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
        .from(schema.monitoringSettings)
        .where(tenantFilter(session.user, schema.monitoringSettings.tenantId))
        .limit(1);
      return { data: row ? toMasked(row) : DEFAULTS };
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

      const patch: Partial<NewMonitoringSettings> = {};
      applySecret(patch, data.sentryDsn);
      if (data.environment !== undefined)
        patch.environment = data.environment === '' ? null : data.environment;
      if (data.releaseTag !== undefined)
        patch.releaseTag = data.releaseTag === '' ? null : data.releaseTag;
      if (data.tracesSampleRate !== undefined)
        patch.tracesSampleRate = data.tracesSampleRate;
      if (data.captureUnhandledErrors !== undefined)
        patch.captureUnhandledErrors = data.captureUnhandledErrors;
      if (data.includeUserContext !== undefined)
        patch.includeUserContext = data.includeUserContext;

      const [existing] = await db
        .select({ id: schema.monitoringSettings.id })
        .from(schema.monitoringSettings)
        .where(tenantFilter(session.user, schema.monitoringSettings.tenantId))
        .limit(1);

      let row: MonitoringSettings | undefined;
      if (existing) {
        [row] = await db
          .update(schema.monitoringSettings)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(schema.monitoringSettings.id, existing.id))
          .returning();
      } else {
        [row] = await db
          .insert(schema.monitoringSettings)
          .values({ ...patch, tenantId: session.user.tenantId })
          .returning();
      }
      if (!row) throw new Error('monitoring_settings upsert returned no row');
      // Sentry init is once-at-boot; no in-process refresh. The UI surfaces
      // a "restart API service" toast after save.
      return { data: toMasked(row) };
    },
  );
};
