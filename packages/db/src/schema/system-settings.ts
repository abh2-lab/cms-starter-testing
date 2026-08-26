import { sql } from 'drizzle-orm';
import {
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// Per-tenant system / performance config: rate-limit knobs + worker queue
// concurrency. Mirrors site_settings + email_settings + storage_settings +
// monitoring_settings — one row per tenant, single NULL-tenant row in
// single-tenant mode. No secrets.
//
// Rate-limit window is stored as { value, unit } so the form has a clean
// "60 seconds" / "1 minute" picker. The API rate-limit plugin wants the
// plain-English string @fastify/rate-limit parses ('30 seconds', '1 minute');
// the resolver serializes back to that form. See apps/api/src/lib/system-config
// for parse rules including the raw-ms env fallback case ('60000' → 1 minute).
export const systemSettings = pgTable(
  'system_settings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    rateLimitMax: integer('rate_limit_max').notNull().default(100),
    rateLimitWindowValue: integer('rate_limit_window_value')
      .notNull()
      .default(1),
    // 'second' or 'minute' (singular — matches the strings @fastify/rate-limit
    // accepts when value=1; the resolver pluralises before passing to the
    // plugin).
    rateLimitWindowUnit: text('rate_limit_window_unit')
      .notNull()
      .default('minute'),
    workerImageConcurrency: integer('worker_image_concurrency')
      .notNull()
      .default(2),
    workerWebhookConcurrency: integer('worker_webhook_concurrency')
      .notNull()
      .default(16),
    workerSearchIndexConcurrency: integer('worker_search_index_concurrency')
      .notNull()
      .default(8),
    workerSchedulePublishConcurrency: integer(
      'worker_schedule_publish_concurrency',
    )
      .notNull()
      .default(4),
    workerEmailConcurrency: integer('worker_email_concurrency')
      .notNull()
      .default(4),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('system_settings_tenant_id_uniq')
      .on(table.tenantId)
      .nullsNotDistinct(),
  ],
);

export type SystemSettings = typeof systemSettings.$inferSelect;
export type NewSystemSettings = typeof systemSettings.$inferInsert;
