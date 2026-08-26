import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { adminUsers } from './users.js';
import { contentStatus } from './content.js';

// Pages are a first-class CMS entity, SEPARATE from `content` (posts). The
// editorial flows overlap (state machine, revisions, slug uniqueness), so we
// reuse the `content_status` enum and mirror the revision/transition shape —
// but pages have their own table because they carry orthogonal columns
// (static `html`/`css` vs dynamic `template_key`/`blocks`) and a distinct
// public URL scheme (`/:slug` — root-level catch-all in apps/web).
//
// Two page flavours, distinguished by `type`:
//   - 'static'  → admin pastes HTML + CSS; sanitized on save AND on render.
//                 `html` and `css` hold sanitized output. Block columns are
//                 ignored.
//   - 'dynamic' → composed from a developer-shipped Template made of Blocks.
//                 `template_key` records provenance; `blocks` is the
//                 snapshotted, ordered, editable list the admin operates on.
//                 `html` and `css` are ignored.
//
// The split is enforced at the app layer (route handlers + service code), not
// via DB-level CHECK constraints, so a future "convert to dynamic" admin
// action stays cheap. tenant_id is non-null because pages always belong to a
// publisher in our single-tenant-per-install model; content is nullable for
// historical "global" rows but pages were designed after that decision.
export const pageType = pgEnum('page_type', ['static', 'dynamic']);

export const pages = pgTable(
  'pages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    type: pageType('type').notNull(),
    status: contentStatus('status').notNull().default('draft'),
    // Static-only. Stored ALREADY SANITIZED so the public render is hot-path
    // clean — the route still sanitizes again as defense in depth.
    html: text('html'),
    css: text('css'),
    // Dynamic-only. `template_key` is the manifest id of the dev-shipped
    // template the page was originally created from (kept for provenance /
    // future "sync from template" affordance; templates are NOT a DB row).
    templateKey: text('template_key'),
    // Dynamic-only. Ordered list of { block_key, fields, options } snapshotted
    // at template-apply time. Validated against the block manifest at publish.
    blocks: jsonb('blocks').notNull().default(sql`'[]'::jsonb`),
    // Static-only. Editor-picked layout shell (default / full-width /
    // full-width-no-heading / blank / …). Resolved against the theme page-layout
    // registry (@cms/blocks `pageLayoutRegistry`) and applied by the public
    // renderer — a `chromeless` layout (blank) drops the site header/footer.
    // Null on dynamic rows; static rows default to 'default'.
    layoutTemplate: text('layout_template'),
    // Static-only. How the page body is authored:
    //   'raw'    → admin pastes HTML/CSS (the `html`/`css` columns).
    //   'normal' → TipTap rich text, stored as JSON in `body`.
    // The two are stored independently and never auto-converted; existing rows
    // backfill to 'raw' (their content lives in html/css), new static pages
    // default to 'normal' at the API layer.
    contentMode: text('content_mode').notNull().default('raw'),
    // Static-only, Normal mode. TipTap JSON doc for the rich-text body. Null in
    // Raw mode (and on dynamic rows). Rendered via renderTiptap on the public side.
    body: jsonb('body'),
    // Per-page SEO override; the public render merges this on top of the
    // site-level SEO settings. Same shape as content's `seo` payload.
    seo: jsonb('seo').notNull().default(sql`'{}'::jsonb`),
    // Multi-edition readiness — replicated from `content` from day one so a
    // future locale rollout is a no-DDL change, even though M1 ignores both.
    locale: text('locale').notNull().default('en'),
    translationGroupId: uuid('translation_group_id'),
    // Seeded-and-protected rows (the migrated about/contact/privacy/terms/
    // editorial-policy, and the home page) cannot be deleted from the admin
    // — they back hard-coded URLs (or, in home's case, /). The admin UI hides
    // the delete control; the API enforces it. Defaults false for everything
    // editor-created.
    systemManaged: boolean('system_managed').notNull().default(false),
    authorId: uuid('author_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    publishedBy: uuid('published_by').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    publishAt: timestamp('publish_at', { withTimezone: true }),
    unpublishAt: timestamp('unpublish_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Slug must be unique within a tenant. Unlike `content` we don't need to
    // scope by type — `/about` and `/about-the-team` are different
    // URLs regardless of whether each is static or dynamic.
    unique('pages_tenant_slug_uniq')
      .on(table.tenantId, table.slug)
      .nullsNotDistinct(),
    // The hot public query: filter by tenant + status + publish window.
    index('pages_tenant_status_publish_idx').on(
      table.tenantId,
      table.status,
      table.publishAt,
    ),
    // Admin filtered list ("show me all dynamic drafts").
    index('pages_tenant_type_status_idx').on(
      table.tenantId,
      table.type,
      table.status,
    ),
    // Author "my pages" listings.
    index('pages_author_idx').on(table.authorId),
    // Translation lookups — partial index only over rows actually in a group.
    index('pages_translation_group_idx')
      .on(table.translationGroupId)
      .where(sql`translation_group_id IS NOT NULL`),
  ],
);

// Append-only snapshot history. `snapshot` captures the full page row at the
// moment of save (jsonb_build_object of the relevant columns; app-side).
// `revision_number` is monotonic per page. Mirrors `content_revisions`.
export const pageRevisions = pgTable(
  'page_revisions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
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
    uniqueIndex('page_revisions_page_revision_uniq').on(
      table.pageId,
      table.revisionNumber,
    ),
  ],
);

// Append-only audit of every status transition. `from_status` is nullable for
// the initial state (no prior status). Mirrors `content_status_transitions`.
export const pageStatusTransitions = pgTable(
  'page_status_transitions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    fromStatus: contentStatus('from_status'),
    toStatus: contentStatus('to_status').notNull(),
    changedBy: uuid('changed_by').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('page_status_transitions_page_idx').on(
      table.pageId,
      table.createdAt,
    ),
  ],
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type PageRevision = typeof pageRevisions.$inferSelect;
export type NewPageRevision = typeof pageRevisions.$inferInsert;
export type PageStatusTransition = typeof pageStatusTransitions.$inferSelect;
export type NewPageStatusTransition = typeof pageStatusTransitions.$inferInsert;
