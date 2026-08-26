import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { adminUsers } from './users.js';

// Theme-engine v2.0 override storage. Code-shipped templates and parts (the
// @cms/blocks registries) stay the defaults; this table stores a publisher's
// per-template/part REPLACEMENT block-tree. Resolution everywhere is binary:
// DB override → code default — never an auto-merge. "Reset to default"
// deletes the row.
//
// Draft and published live as SEPARATE COLUMNS, not a status enum, because
// both legitimately coexist: a live published override AND a pending draft
// on top of it. Derived states the admin UI badges from one row:
//   draft_blocks ∅ + published_blocks ∅   → (row absent — pure code default)
//   draft_blocks ✔ + published_blocks ∅   → draft only (nothing live yet)
//   draft_blocks ∅ + published_blocks ✔   → customized, no pending edits
//   draft_blocks ✔ + published_blocks ✔   → customized + pending draft
export const themeOverrides = pgTable(
  'theme_overrides',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    // 'template' | 'part' — which registry the key belongs to. Informational
    // for the Structure list; the key itself is unique across both
    // namespaces (template keys vs part keys never collide by convention).
    kind: text('kind').notNull(),
    // The code template/part's own key ('single-article', 'archive-category',
    // 'header', …). For role 'single' this is the TEMPLATE key — never the
    // post-template VARIANT key (article-standard/article-feature), which
    // only drives ArticleView's CSS variant.
    templateKey: text('template_key').notNull(),
    // Pending draft tree (PageBlockInstance[]). Null = no draft.
    draftBlocks: jsonb('draft_blocks'),
    // Live override tree. Null = nothing published (code default renders).
    publishedBlocks: jsonb('published_blocks'),
    // The code template's `version` this override was authored against.
    // "Update available" badge = codeTemplate.version > base_version.
    baseVersion: integer('base_version').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    publishedBy: uuid('published_by').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One override row per template/part per tenant — the resolution lookup.
    unique('theme_overrides_tenant_key_uniq').on(
      table.tenantId,
      table.templateKey,
    ),
    // The Structure list ("everything customized for this tenant").
    index('theme_overrides_tenant_kind_idx').on(table.tenantId, table.kind),
  ],
);

// Append-only snapshot history, mirroring page_revisions. Snapshotted on
// PUBLISH only (draft saves are keystroke-frequency form edits); restore
// copies a snapshot back into draft_blocks — never directly live.
export const themeOverrideRevisions = pgTable(
  'theme_override_revisions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    overrideId: uuid('override_id')
      .notNull()
      .references(() => themeOverrides.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    // The published tree + metadata at publish time (app-side object).
    snapshot: jsonb('snapshot').notNull(),
    changedBy: uuid('changed_by').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    changeSummary: text('change_summary'),
    revisionNumber: integer('revision_number').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('theme_override_revisions_override_revision_uniq').on(
      table.overrideId,
      table.revisionNumber,
    ),
  ],
);

export type ThemeOverride = typeof themeOverrides.$inferSelect;
export type NewThemeOverride = typeof themeOverrides.$inferInsert;
export type ThemeOverrideRevision =
  typeof themeOverrideRevisions.$inferSelect;
export type NewThemeOverrideRevision =
  typeof themeOverrideRevisions.$inferInsert;
