import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// Drizzle has no built-in bytea — same minimal mapping used by webhooks.ts.
// Holds provider credentials encrypted at rest (AES-256-GCM via
// WEBHOOK_SECRET_ENCRYPTION_KEY, the same envelope used for webhook secrets:
// [12-byte IV][16-byte tag][ciphertext]). Encrypt/decrypt with
// encryptWebhookSecret/decryptWebhookSecret from @cms/queue.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// Which transport sends notification email. 'brevo' maps to the Brevo
// (formerly SendinBlue) transactional API. 'stub' logs to the worker console
// and sends nothing — the safe default for an unconfigured install.
export const emailProvider = pgEnum('email_provider', [
  'smtp',
  'resend',
  'brevo',
  'stub',
]);

// Per-tenant email configuration, editable from the admin UI (Settings → Email)
// instead of env vars. One row per tenant (or a single NULL-tenant row in
// single-tenant mode), mirroring site_settings. Secret columns are bytea and
// MUST be stored encrypted — never persist raw passwords/API keys.
export const emailSettings = pgTable(
  'email_settings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    provider: emailProvider('provider').notNull().default('stub'),

    // Sender identity (how mail appears to recipients).
    fromName: text('from_name'),
    fromAddress: text('from_address'),
    replyTo: text('reply_to'),

    // SMTP connection. Non-secret bits are plain columns; the password/API key
    // lives in smtp_pass_encrypted.
    smtpHost: text('smtp_host'),
    smtpPort: integer('smtp_port').notNull().default(587),
    smtpSecure: boolean('smtp_secure').notNull().default(false),
    smtpUser: text('smtp_user'),
    smtpPassEncrypted: bytea('smtp_pass_encrypted'),

    // HTTPS-API provider keys, encrypted at rest.
    resendKeyEncrypted: bytea('resend_key_encrypted'),
    brevoKeyEncrypted: bytea('brevo_key_encrypted'),

    // Notification triggers. review + approval are wired to real events;
    // publish / reader_submission / health_alerts have no trigger yet (stored
    // for future use, surfaced as disabled in the UI).
    notifyOnReview: boolean('notify_on_review').notNull().default(true),
    notifyOnApproval: boolean('notify_on_approval').notNull().default(true),
    notifyOnPublish: boolean('notify_on_publish').notNull().default(false),
    notifyOnReaderSubmission: boolean('notify_on_reader_submission')
      .notNull()
      .default(false),
    notifyOnHealthAlerts: boolean('notify_on_health_alerts')
      .notNull()
      .default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One row per tenant. nullsNotDistinct so single-tenant mode is limited to
    // exactly one NULL-tenant row (matches site_settings).
    unique('email_settings_tenant_id_uniq')
      .on(table.tenantId)
      .nullsNotDistinct(),
  ],
);

export type EmailSettings = typeof emailSettings.$inferSelect;
export type NewEmailSettings = typeof emailSettings.$inferInsert;
