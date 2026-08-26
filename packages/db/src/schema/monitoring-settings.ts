import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// bytea for the encrypted DSN — DSN technically isn't a credential in the
// "password" sense (a Sentry DSN can write events but not read project data)
// but it's still sensitive enough to keep out of plaintext. Same envelope as
// email/storage secret columns.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// Per-tenant error-monitoring config, editable from the admin UI (Settings →
// Infrastructure → Monitoring) instead of SENTRY_* env vars. One row per
// tenant (or single NULL-tenant row in single-tenant mode), mirroring
// site_settings + email_settings + storage_settings.
//
// Sentry init is once-at-boot for the API process: changes here require an
// API restart to take effect. The dashboard surfaces this caveat after a
// successful save.
export const monitoringSettings = pgTable(
  'monitoring_settings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    sentryDsnEncrypted: bytea('sentry_dsn_encrypted'),
    // Free-text so deploys can disambiguate e.g. "staging" from "production"
    // even when both run NODE_ENV=production. Empty = fall back to NODE_ENV
    // at init time (matches the prior env-driven behaviour).
    environment: text('environment'),
    // Typically a git SHA, surfaced in Sentry as the release tag — events
    // group by this so a regression-introducing deploy is visible.
    releaseTag: text('release_tag'),
    // 0-100 (UI shows this as a percentage). Divided by 100 at the Sentry
    // init call site. 0 = error-only capture (zero perf overhead).
    tracesSampleRate: integer('traces_sample_rate').notNull().default(0),
    captureUnhandledErrors: boolean('capture_unhandled_errors')
      .notNull()
      .default(true),
    // When true, attach the logged-in admin user id to each captured event
    // (via Sentry.setUser at request scope). Defaults off — privacy-by-default.
    includeUserContext: boolean('include_user_context').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('monitoring_settings_tenant_id_uniq')
      .on(table.tenantId)
      .nullsNotDistinct(),
  ],
);

export type MonitoringSettings = typeof monitoringSettings.$inferSelect;
export type NewMonitoringSettings = typeof monitoringSettings.$inferInsert;
