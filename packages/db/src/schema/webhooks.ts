import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// Drizzle doesn't ship a built-in bytea type — define a minimal custom one
// that maps to Postgres bytea and to a Node Buffer at the TS boundary.
// Used for webhook signing secrets, encrypted at rest by the worker with
// WEBHOOK_SECRET_ENCRYPTION_KEY (envelope encryption: a per-row IV stored
// in the ciphertext, AES-256-GCM, see apps/worker/src/processors/webhook-deliver.ts).
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// Configured webhook endpoints. `secret_hash` is the SHA-256 hash of the
// signing secret — historically the only column, kept for back-compat. It
// can verify a shown-once-at-creation token but is **irreversible**, so the
// worker cannot use it to HMAC-sign outgoing deliveries.
//
// `secret_encrypted` (added in Phase 6) holds the raw secret encrypted with
// the env master key, so the worker can decrypt and HMAC requests. New
// webhooks populate both; old webhooks have NULL secret_encrypted and need
// "Rotate secret" before delivery works.
//
// events is the list of event names this webhook subscribes to (e.g.
// ['content.published', 'content.deleted']).
export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secretHash: text('secret_hash').notNull(),
    /**
     * AES-256-GCM(secret) using WEBHOOK_SECRET_ENCRYPTION_KEY. Layout:
     * [12-byte IV][16-byte auth tag][ciphertext]. NULL on legacy rows that
     * predate Phase 6 — those webhooks must be rotated before delivery
     * can sign their payloads.
     */
    secretEncrypted: bytea('secret_encrypted'),
    events: text('events').array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('webhooks_tenant_idx').on(table.tenantId),
    // GIN: "find webhooks listening on event X" via events @> ARRAY['x'].
    index('webhooks_events_gin_idx').using('gin', table.events),
  ],
);

// Append-only delivery log. attempt_number increments per retry.
// next_retry_at is set when a delivery fails and is queued for retry;
// cleared when delivery succeeds or the retry budget is exhausted.
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    eventName: text('event_name').notNull(),
    payload: jsonb('payload').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Retry queue — partial index covers only rows actively scheduled to retry.
    index('webhook_deliveries_retry_idx')
      .on(table.webhookId, table.nextRetryAt)
      .where(sql`next_retry_at IS NOT NULL`),
    index('webhook_deliveries_webhook_idx').on(table.webhookId),
  ],
);

export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
