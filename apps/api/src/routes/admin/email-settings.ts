import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { encryptWebhookSecret } from '@cms/queue';
import { tenantFilter } from '../../lib/tenant-scope.js';
import {
  buildTransport,
  resolveEmailConfig,
  type EmailTransport,
} from '@cms/email';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

type EmailSettings = typeof schema.emailSettings.$inferSelect;
type NewEmailSettings = typeof schema.emailSettings.$inferInsert;

// Sent in place of any stored secret. The UI shows this when a secret exists;
// PATCHing it back unchanged means "leave the stored value alone".
const MASK = '••••••••';

// Email or empty string — empty clears the field (falls back to env at send).
const emailOrEmpty = z.union([z.string().email().max(320), z.literal('')]);

const PatchBody = z.object({
  provider: z.enum(['smtp', 'resend', 'brevo', 'stub']).optional(),
  fromName: z.string().max(200).nullable().optional(),
  fromAddress: emailOrEmpty.nullable().optional(),
  replyTo: emailOrEmpty.nullable().optional(),
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(320).nullable().optional(),
  // Secrets: the raw value, the MASK (unchanged), or '' (clear).
  smtpPass: z.string().max(2048).optional(),
  resendApiKey: z.string().max(2048).optional(),
  brevoApiKey: z.string().max(2048).optional(),
  notifyOnReview: z.boolean().optional(),
  notifyOnApproval: z.boolean().optional(),
  notifyOnReaderSubmission: z.boolean().optional(),
  // notifyOnPublish / notifyOnHealthAlerts are NOT accepted — they have no
  // trigger yet and are disabled in the UI.
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

function isConfigured(row: EmailSettings): boolean {
  switch (row.provider) {
    case 'smtp':
      return Boolean(row.smtpHost && row.smtpHost.length > 0);
    case 'resend':
      return Boolean(row.resendKeyEncrypted);
    case 'brevo':
      return Boolean(row.brevoKeyEncrypted);
    case 'stub':
    default:
      return true;
  }
}

// Never returns ciphertext: a set secret becomes the MASK, an unset one ''.
function toMasked(row: EmailSettings) {
  return {
    provider: row.provider,
    fromName: row.fromName ?? '',
    fromAddress: row.fromAddress ?? '',
    replyTo: row.replyTo ?? '',
    smtpHost: row.smtpHost ?? '',
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    smtpUser: row.smtpUser ?? '',
    smtpPass: row.smtpPassEncrypted ? MASK : '',
    resendApiKey: row.resendKeyEncrypted ? MASK : '',
    brevoApiKey: row.brevoKeyEncrypted ? MASK : '',
    notifyOnReview: row.notifyOnReview,
    notifyOnApproval: row.notifyOnApproval,
    notifyOnPublish: row.notifyOnPublish,
    notifyOnReaderSubmission: row.notifyOnReaderSubmission,
    notifyOnHealthAlerts: row.notifyOnHealthAlerts,
    isConfigured: isConfigured(row),
  };
}

// Shape returned when no row exists yet — stub, unconfigured, defaults.
const DEFAULTS = {
  provider: 'stub' as const,
  fromName: '',
  fromAddress: '',
  replyTo: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPass: '',
  resendApiKey: '',
  brevoApiKey: '',
  notifyOnReview: true,
  notifyOnApproval: true,
  notifyOnPublish: false,
  notifyOnReaderSubmission: false,
  notifyOnHealthAlerts: false,
  isConfigured: true,
};

// Apply an incoming secret: undefined (not sent) and MASK (unchanged) are
// no-ops; '' clears the column; anything else is encrypted at rest.
function applySecret(
  patch: Partial<NewEmailSettings>,
  column: 'smtpPassEncrypted' | 'resendKeyEncrypted' | 'brevoKeyEncrypted',
  value: string | undefined,
) {
  if (value === undefined || value === MASK) return;
  patch[column] = value === '' ? null : encryptWebhookSecret(value);
}

export const adminEmailSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // GET / — current settings (secrets masked) + isConfigured.
  fastify.get(
    '/',
    { preHandler: requireAdminRole('super_admin') },
    async (request) => {
      const session = getSession(request);
      const [row] = await db
        .select()
        .from(schema.emailSettings)
        .where(tenantFilter(session.user, schema.emailSettings.tenantId))
        .limit(1);
      return { data: row ? toMasked(row) : DEFAULTS };
    },
  );

  // PATCH / — upsert a subset of fields. Mask-aware secret handling.
  fastify.patch(
    '/',
    { preHandler: requireAdminRole('super_admin') },
    async (request, reply) => {
      const parsed = PatchBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const session = getSession(request);
      const data = parsed.data;

      const patch: Partial<NewEmailSettings> = {};
      if (data.provider !== undefined) patch.provider = data.provider;
      if (data.fromName !== undefined) patch.fromName = data.fromName;
      if (data.fromAddress !== undefined)
        patch.fromAddress = data.fromAddress === '' ? null : data.fromAddress;
      if (data.replyTo !== undefined)
        patch.replyTo = data.replyTo === '' ? null : data.replyTo;
      if (data.smtpHost !== undefined) patch.smtpHost = data.smtpHost;
      if (data.smtpPort !== undefined) patch.smtpPort = data.smtpPort;
      if (data.smtpSecure !== undefined) patch.smtpSecure = data.smtpSecure;
      if (data.smtpUser !== undefined) patch.smtpUser = data.smtpUser;
      applySecret(patch, 'smtpPassEncrypted', data.smtpPass);
      applySecret(patch, 'resendKeyEncrypted', data.resendApiKey);
      applySecret(patch, 'brevoKeyEncrypted', data.brevoApiKey);
      if (data.notifyOnReview !== undefined)
        patch.notifyOnReview = data.notifyOnReview;
      if (data.notifyOnApproval !== undefined)
        patch.notifyOnApproval = data.notifyOnApproval;
      if (data.notifyOnReaderSubmission !== undefined)
        patch.notifyOnReaderSubmission = data.notifyOnReaderSubmission;

      const [existing] = await db
        .select({ id: schema.emailSettings.id })
        .from(schema.emailSettings)
        .where(tenantFilter(session.user, schema.emailSettings.tenantId))
        .limit(1);

      let row: EmailSettings | undefined;
      if (existing) {
        [row] = await db
          .update(schema.emailSettings)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(schema.emailSettings.id, existing.id))
          .returning();
      } else {
        [row] = await db
          .insert(schema.emailSettings)
          .values({ ...patch, tenantId: session.user.tenantId })
          .returning();
      }
      if (!row) throw new Error('email_settings upsert returned no row');
      return { data: toMasked(row) };
    },
  );

  // POST /test — send a real test email to the logged-in admin using the
  // SAVED settings (not unsaved form values). Synchronous {success,message}.
  fastify.post(
    '/test',
    { preHandler: requireAdminRole('super_admin') },
    async (request) => {
      const session = getSession(request);
      const to = session.user.email;

      // Everything (config resolution, decrypt, transport build, send) runs
      // inside the try so any failure becomes a clean { success:false } result
      // instead of a 500 — the UI shows the message rather than a generic error.
      let transport: EmailTransport | undefined;
      try {
        const { config } = await resolveEmailConfig({
          tenantId: session.user.tenantId,
        });

        if (config.provider === 'stub') {
          return {
            data: {
              success: true,
              message:
                'Stub mode — email is logged to the worker console, nothing is sent.',
            },
          };
        }

        transport = buildTransport(config);
        const result = await transport.send({
          to,
          subject: 'CMS test email',
          html: '<p>This is a test email confirming your CMS email settings work.</p>',
          text: 'This is a test email confirming your CMS email settings work.',
        });
        return {
          data: {
            success: true,
            message: `Test email sent to ${to} (id ${result.messageId}).`,
          },
        };
      } catch (err) {
        return {
          data: {
            success: false,
            message: err instanceof Error ? err.message : 'Failed to send.',
          },
        };
      } finally {
        if (transport) await transport.close().catch(() => undefined);
      }
    },
  );
};
