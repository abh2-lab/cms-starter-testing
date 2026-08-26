import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Update state for THIS INSTALL — deliberately NOT tenant-scoped.
//
// Every other settings table (site/email/storage/monitoring/system) carries a
// tenant_id because they configure a publication. This one describes the
// software the box is running, which is a property of the install, not of a
// tenant. One tenant per install is the shipped model (see
// docs/phase-3-versioning-and-updates-plan.md), so adding tenant_id here would
// be noise that later has to be un-picked.
//
// Singleton: exactly one row, pinned by a unique index on the constant
// `singleton` column. Upserts target that conflict target, so a race between
// the worker's daily check and an operator's manual check can't produce two rows.
//
// The install's OWN version is not stored here — it is baked into the build
// (CMS_VERSION, from the root package.json) and read from env. Storing it would
// create a second source of truth that goes stale the moment a container is
// rebuilt. This table only records what the release manifest last advertised.
export const updateStatus = pgTable(
  'update_status',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    // Always the literal 'singleton'. Exists purely to give the unique index
    // (and therefore ON CONFLICT) something stable to target.
    singleton: text('singleton').notNull().default('singleton'),

    // ─── What the manifest last advertised ──────────────────────────────────
    // All nullable: a fresh install has never completed a check.
    latestVersion: text('latest_version'),
    // 'code' | 'schema'. Deliberately TEXT, not a pgEnum — enum values cannot
    // be removed without a breaking migration, and this vocabulary may grow
    // (see the additive-only rule in CLAUDE.md).
    latestType: text('latest_type'),
    latestReleasedAt: timestamp('latest_released_at', { withTimezone: true }),
    latestNotesUrl: text('latest_notes_url'),
    // Lowest version that may upgrade straight to latestVersion. An install
    // older than this must hop to an intermediate release first (the GitLab
    // required-upgrade-path model).
    minUpgradeFrom: text('min_upgrade_from'),
    // True for any release that runs migrations — the admin then requires an
    // explicit confirmation and a database backup before applying.
    requiresBackup: boolean('requires_backup').notNull().default(false),
    // string[] — env vars that must be set BEFORE the new version boots.
    // @cms/config's Zod validation exits the container if they're missing, so
    // surfacing them in the banner turns a crash-loop into a checklist.
    newEnvVars: jsonb('new_env_vars').notNull().default(sql`'[]'::jsonb`),

    // ─── Check bookkeeping ──────────────────────────────────────────────────
    // Last time a check COMPLETED, successfully or not. Null = never checked.
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    // Last failure message; cleared on the next success. Kept so the admin can
    // distinguish "no update" from "we haven't been able to look".
    checkError: text('check_error'),
    // Operator opt-out. Some publishers will not want a daily outbound call.
    checkEnabled: boolean('check_enabled').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('update_status_singleton_uniq').on(table.singleton)],
);

export type UpdateStatus = typeof updateStatus.$inferSelect;
export type NewUpdateStatus = typeof updateStatus.$inferInsert;
