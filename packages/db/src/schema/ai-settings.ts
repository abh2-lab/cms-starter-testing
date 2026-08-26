import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// bytea for the encrypted provider API key — same envelope as the
// email/storage/monitoring secret columns (encryptWebhookSecret from
// @cms/queue). Kept out of plaintext and masked on read by the route.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// Per-tenant AI-assistant config, editable from the admin UI (Settings →
// Infrastructure → AI Assistant) instead of env vars. One row per tenant
// (or a single NULL-tenant row in single-tenant mode), mirroring
// monitoring_settings + email_settings + storage_settings.
//
// Provider-agnostic by design: the integration speaks the OpenAI-compatible
// Chat Completions wire format, so `provider` is only a UX preset that fills
// `baseUrl` (OpenAI / Anthropic / Google all expose compatible endpoints).
// `model` is free text — no hardcoded default.
export const aiSettings = pgTable(
  'ai_settings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    // Master switch. When false the chat endpoint refuses and the panel hides.
    enabled: boolean('enabled').notNull().default(false),
    // UX preset label only ('openai' | 'anthropic' | 'google' | 'custom').
    // Drives the default base URL in the tab; the wire format is identical.
    provider: text('provider'),
    apiKeyEncrypted: bytea('api_key_encrypted'),
    // Free-text model id, e.g. 'gpt-4o', 'claude-sonnet-4-6', 'gemini-2.5-pro'.
    model: text('model'),
    // OpenAI-compatible base URL, e.g. https://api.openai.com/v1. Nullable so a
    // brand-new row is "not configured"; the chat route requires it to be set.
    baseUrl: text('base_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('ai_settings_tenant_id_uniq')
      .on(table.tenantId)
      .nullsNotDistinct(),
  ],
);

export type AiSettings = typeof aiSettings.$inferSelect;
export type NewAiSettings = typeof aiSettings.$inferInsert;
