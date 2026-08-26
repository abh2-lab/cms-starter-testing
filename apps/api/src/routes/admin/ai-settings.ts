import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { encryptWebhookSecret } from '@cms/queue';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

type AiSettings = typeof schema.aiSettings.$inferSelect;
type NewAiSettings = typeof schema.aiSettings.$inferInsert;

const MASK = '••••••••';

const PatchBody = z.object({
  // Mask-aware secret: MASK = no change, '' = clear, anything else = encrypt.
  apiKey: z.string().max(2048).optional(),
  enabled: z.boolean().optional(),
  provider: z.string().max(64).nullable().optional(),
  model: z.string().max(255).nullable().optional(),
  baseUrl: z.string().max(2048).nullable().optional(),
});

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
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

// "Configured" = usable for a chat call: a key, a model, and a base URL are
// all present. `enabled` is tracked separately so the tab can show a toggle
// that's on but not yet fully filled in.
export function isAiConfigured(row: AiSettings): boolean {
  return Boolean(
    row.apiKeyEncrypted &&
      row.apiKeyEncrypted.length > 0 &&
      row.model &&
      row.model.length > 0 &&
      row.baseUrl &&
      row.baseUrl.length > 0,
  );
}

function toMasked(row: AiSettings) {
  return {
    apiKey: row.apiKeyEncrypted ? MASK : '',
    enabled: row.enabled,
    provider: row.provider ?? '',
    model: row.model ?? '',
    baseUrl: row.baseUrl ?? '',
    isConfigured: isAiConfigured(row),
  };
}

const DEFAULTS = {
  apiKey: '',
  enabled: false,
  provider: '',
  model: '',
  baseUrl: '',
  isConfigured: false,
};

function applySecret(patch: Partial<NewAiSettings>, value: string | undefined) {
  if (value === undefined || value === MASK) return;
  patch.apiKeyEncrypted = value === '' ? null : encryptWebhookSecret(value);
}

export const adminAiSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  fastify.get(
    '/',
    { preHandler: requireAdminRole('super_admin') },
    async (request) => {
      const session = getSession(request);
      const [row] = await db
        .select()
        .from(schema.aiSettings)
        .where(tenantFilter(session.user, schema.aiSettings.tenantId))
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

      const patch: Partial<NewAiSettings> = {};
      applySecret(patch, data.apiKey);
      if (data.enabled !== undefined) patch.enabled = data.enabled;
      if (data.provider !== undefined)
        patch.provider = data.provider === '' ? null : data.provider;
      if (data.model !== undefined)
        patch.model = data.model === '' ? null : data.model;
      if (data.baseUrl !== undefined)
        patch.baseUrl = data.baseUrl === '' ? null : data.baseUrl;

      const [existing] = await db
        .select({ id: schema.aiSettings.id })
        .from(schema.aiSettings)
        .where(tenantFilter(session.user, schema.aiSettings.tenantId))
        .limit(1);

      let row: AiSettings | undefined;
      if (existing) {
        [row] = await db
          .update(schema.aiSettings)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(schema.aiSettings.id, existing.id))
          .returning();
      } else {
        [row] = await db
          .insert(schema.aiSettings)
          .values({ ...patch, tenantId: session.user.tenantId })
          .returning();
      }
      if (!row) throw new Error('ai_settings upsert returned no row');
      return { data: toMasked(row) };
    },
  );
};
