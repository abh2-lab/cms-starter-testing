import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { encryptWebhookSecret } from '@cms/queue';
import { reloadStorageClients, testStorageConfig } from '../../lib/s3.js';
import { resolveStorageConfig } from '../../lib/storage-config.js';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

type StorageSettings = typeof schema.storageSettings.$inferSelect;
type NewStorageSettings = typeof schema.storageSettings.$inferInsert;

// Same masking semantics as email-settings: GET returns this in place of any
// stored secret; PATCHing it back unchanged is a no-op.
const MASK = '••••••••';

// Allows null / '' (clear the column) OR a full http(s):// URL. Catches the
// same "http:host" footgun siteUrl had — relative-looking values break the
// browser-facing URL construction the storage layer does at presign time.
const optionalHttpUrl = z
  .string()
  .max(2048)
  .nullable()
  .optional()
  .refine(
    (v) => v == null || v === '' || /^https?:\/\/.+/.test(v),
    { message: 'Must start with http:// or https:// (note the two slashes).' },
  );

const PatchBody = z.object({
  provider: z.enum(['minio', 'aws', 'r2', 'do', 'gcs']).optional(),
  bucket: z.string().min(1).max(255).optional(),
  region: z.string().max(64).nullable().optional(),
  forcePathStyle: z.boolean().optional(),
  accessKeyId: z.string().max(255).nullable().optional(),
  // Mask-aware secret: the literal MASK = no change, '' = clear, anything else = encrypt.
  secretAccessKey: z.string().max(2048).optional(),
  publicMediaUrl: optionalHttpUrl,
  publicApiEndpoint: optionalHttpUrl,
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

// "Configured" = bucket name + access key id + secret key all present. A
// missing piece falls back to env, which may also be unconfigured.
function isConfigured(row: StorageSettings): boolean {
  return Boolean(
    row.bucket &&
      row.accessKeyId &&
      row.accessKeyId.length > 0 &&
      row.secretAccessKeyEncrypted &&
      row.secretAccessKeyEncrypted.length > 0,
  );
}

function toMasked(row: StorageSettings) {
  return {
    provider: row.provider,
    bucket: row.bucket,
    region: row.region ?? '',
    forcePathStyle: row.forcePathStyle,
    accessKeyId: row.accessKeyId ?? '',
    secretAccessKey: row.secretAccessKeyEncrypted ? MASK : '',
    publicMediaUrl: row.publicMediaUrl ?? '',
    publicApiEndpoint: row.publicApiEndpoint ?? '',
    isConfigured: isConfigured(row),
  };
}

// Shape returned when no row exists. `isConfigured: false` so the dashboard
// shows a "Not configured" chip; env-fallback callers still work in the
// background (the runtime layer uses env values when the row is absent).
const DEFAULTS = {
  provider: 'minio' as const,
  bucket: '',
  region: '',
  forcePathStyle: true,
  accessKeyId: '',
  secretAccessKey: '',
  publicMediaUrl: '',
  publicApiEndpoint: '',
  isConfigured: false,
};

function applySecret(
  patch: Partial<NewStorageSettings>,
  value: string | undefined,
) {
  if (value === undefined || value === MASK) return;
  patch.secretAccessKeyEncrypted =
    value === '' ? null : encryptWebhookSecret(value);
}

export const adminStorageSettingsRoutes: FastifyPluginAsync = async (
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
        .from(schema.storageSettings)
        .where(tenantFilter(session.user, schema.storageSettings.tenantId))
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

      const patch: Partial<NewStorageSettings> = {};
      if (data.provider !== undefined) patch.provider = data.provider;
      if (data.bucket !== undefined) patch.bucket = data.bucket;
      if (data.region !== undefined)
        patch.region = data.region === '' ? null : data.region;
      if (data.forcePathStyle !== undefined)
        patch.forcePathStyle = data.forcePathStyle;
      if (data.accessKeyId !== undefined)
        patch.accessKeyId = data.accessKeyId === '' ? null : data.accessKeyId;
      applySecret(patch, data.secretAccessKey);
      if (data.publicMediaUrl !== undefined)
        patch.publicMediaUrl =
          data.publicMediaUrl === '' ? null : data.publicMediaUrl;
      if (data.publicApiEndpoint !== undefined)
        patch.publicApiEndpoint =
          data.publicApiEndpoint === '' ? null : data.publicApiEndpoint;

      const [existing] = await db
        .select({ id: schema.storageSettings.id })
        .from(schema.storageSettings)
        .where(tenantFilter(session.user, schema.storageSettings.tenantId))
        .limit(1);

      let row: StorageSettings | undefined;
      if (existing) {
        [row] = await db
          .update(schema.storageSettings)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(schema.storageSettings.id, existing.id))
          .returning();
      } else {
        // Insert needs a non-null bucket — fall back to the empty string the
        // form sends (the patch may not include bucket on first-touch saves
        // that only flip a toggle). Schema is .notNull() but accepts ''.
        const seed: NewStorageSettings = {
          tenantId: session.user.tenantId,
          bucket: patch.bucket ?? '',
          ...patch,
        };
        [row] = await db
          .insert(schema.storageSettings)
          .values(seed)
          .returning();
      }
      if (!row) throw new Error('storage_settings upsert returned no row');

      // Pick up the change in this process without waiting for a deploy.
      // Pass the saving admin's tenantId so the reload resolves the row we
      // just wrote (the PATCH writes tenant-scoped). Boot still defaults
      // to `null` → env fallback in lib/s3.ts.
      await reloadStorageClients(session.user.tenantId);

      return { data: toMasked(row) };
    },
  );

  // POST /test — head-bucket against the SAVED settings (decrypted from DB
  // via the resolver, with env fallback). Synchronous { success, message }
  // — the UI surfaces the message inline rather than throwing on a 5xx.
  fastify.post(
    '/test',
    { preHandler: requireAdminRole('super_admin') },
    async (request) => {
      const session = getSession(request);
      const { config } = await resolveStorageConfig({
        tenantId: session.user.tenantId,
      });
      const result = await testStorageConfig({
        endpoint: config.endpoint,
        publicEndpoint: config.publicEndpoint,
        region: config.region,
        bucket: config.bucket,
        forcePathStyle: config.forcePathStyle,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      });
      if (result.ok) {
        return {
          data: {
            success: true,
            message: `Connection successful — bucket "${config.bucket}" reachable.`,
          },
        };
      }
      return {
        data: {
          success: false,
          message: result.error,
        },
      };
    },
  );
};
