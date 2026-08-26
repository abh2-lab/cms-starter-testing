import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// Drizzle has no built-in bytea — same minimal mapping used by webhooks.ts /
// email-settings.ts. Holds the S3 secret access key encrypted at rest via
// AES-256-GCM (WEBHOOK_SECRET_ENCRYPTION_KEY envelope: [12-byte IV][16-byte
// tag][ciphertext]). Encrypt/decrypt with encryptWebhookSecret /
// decryptWebhookSecret from @cms/queue.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// Cosmetic provider label — every option speaks S3 under the hood. Drives the
// "Storage Provider" select on the Infrastructure → Storage tab and the hint
// copy that follows it; doesn't change runtime behaviour beyond optionally
// shaping defaults the operator might want.
export const storageProvider = pgEnum('storage_provider', [
  'minio',
  'aws',
  'r2',
  'do',
  'gcs',
]);

// Per-tenant S3-compatible storage configuration, editable from the admin UI
// (Settings → Infrastructure → Storage) instead of S3_* env vars. One row per
// tenant or a single NULL-tenant row in single-tenant mode — mirrors
// site_settings + email_settings. The secret access key is bytea and MUST be
// stored encrypted; never persist the raw secret.
export const storageSettings = pgTable(
  'storage_settings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    provider: storageProvider('provider').notNull().default('minio'),

    // Bucket + region. Region is nullable because MinIO and a few S3-clones
    // don't care (the field can be left blank in the UI for those providers).
    bucket: text('bucket').notNull(),
    region: text('region'),
    // MinIO / Garage / R2 need path-style addressing; real AWS S3 needs
    // virtual-hosted-style. Defaulted true to match the MinIO-friendly env.
    forcePathStyle: boolean('force_path_style').notNull().default(true),

    // Access credentials. The secret access key is encrypted; the access key
    // ID is treated as identifying (not a secret) and stored as plain text,
    // matching how SMTP user/password split in email_settings.
    accessKeyId: text('access_key_id'),
    secretAccessKeyEncrypted: bytea('secret_access_key_encrypted'),

    // Browser-facing URLs. publicMediaUrl is the CDN/origin readers GET from
    // (corresponds to S3_PUBLIC_URL); publicApiEndpoint overrides the S3 API
    // host used to sign browser-facing presigned URLs (corresponds to
    // S3_PUBLIC_ENDPOINT). Either can be blank — empty == "use defaults",
    // matching the env fallback behaviour.
    publicMediaUrl: text('public_media_url'),
    publicApiEndpoint: text('public_api_endpoint'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One row per tenant. nullsNotDistinct so single-tenant mode is limited
    // to exactly one NULL-tenant row (matches site_settings / email_settings).
    unique('storage_settings_tenant_id_uniq')
      .on(table.tenantId)
      .nullsNotDistinct(),
  ],
);

export type StorageSettings = typeof storageSettings.$inferSelect;
export type NewStorageSettings = typeof storageSettings.$inferInsert;
