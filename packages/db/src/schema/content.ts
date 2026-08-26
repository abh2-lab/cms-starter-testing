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
import { contentTypes } from './content-types.js';
import { adminUsers } from './users.js';

export const contentStatus = pgEnum('content_status', [
  'draft',
  'in_review',
  'approved',
  'scheduled',
  'published',
  'archived',
]);

// The core content row. tenant_id is nullable so global/system content can
// exist (rare; primarily for cross-tenant "About" or "Terms" pages).
// custom_fields stores the per-content_type field values (shape governed by
// content_types.field_definitions; validated at the app layer).
//
// view_count is a denormalized cache, updated by a Phase 6 worker that rolls
// up content_view_events. The public read path never writes here — that
// would cause row-level lock contention under traffic.
export const content = pgTable(
  'content',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    contentTypeId: uuid('content_type_id')
      .notNull()
      .references(() => contentTypes.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    status: contentStatus('status').notNull().default('draft'),
    authorId: uuid('author_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    publishedBy: uuid('published_by').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    publishAt: timestamp('publish_at', { withTimezone: true }),
    unpublishAt: timestamp('unpublish_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    featured: boolean('featured').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    customFields: jsonb('custom_fields').notNull().default(sql`'{}'::jsonb`),
    // Per-post template override (WordPress-style "single" template). Null =
    // use the content type's default (content_types.settings.templates.default),
    // which itself falls back to the theme's built-in default. The theme maps
    // the key to a layout; see packages/blocks post-templates.
    templateKey: text('template_key'),
    locale: text('locale').notNull().default('en'),
    translationGroupId: uuid('translation_group_id'),
    viewCount: integer('view_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('content_tenant_type_slug_uniq')
      .on(table.tenantId, table.contentTypeId, table.slug)
      .nullsNotDistinct(),
    // The most common public query: filter by tenant + status + publish window.
    index('content_tenant_status_publish_idx').on(
      table.tenantId,
      table.status,
      table.publishAt,
    ),
    // Sort key for /api/public/archive — supports
    // `ORDER BY COALESCE(publish_at, published_at) DESC` so the planner can
    // serve the listing via Index Scan rather than a heap sort. The visible
    // timestamp is whichever of publish_at (scheduled) or published_at
    // (manually published) is populated — see archive.ts orderBy.
    index('content_tenant_status_visible_idx').on(
      table.tenantId,
      table.status,
      sql`COALESCE(publish_at, published_at) DESC`,
    ),
    // Admin filtered content lists.
    index('content_tenant_type_status_idx').on(
      table.tenantId,
      table.contentTypeId,
      table.status,
    ),
    // Translation lookups — partial index covers only rows in a translation group.
    index('content_translation_group_idx')
      .on(table.translationGroupId)
      .where(sql`translation_group_id IS NOT NULL`),
    // Author "my content" listings in admin.
    index('content_author_idx').on(table.authorId),
  ],
);

// Append-only history. snapshot is the full content row at the time of save
// (jsonb_build_object of the relevant columns; app-side). revision_number is
// monotonic per content row.
export const contentRevisions = pgTable(
  'content_revisions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
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
    uniqueIndex('content_revisions_content_revision_uniq').on(
      table.contentId,
      table.revisionNumber,
    ),
  ],
);

// Append-only audit of every status transition. from_status is nullable for
// the initial state (no prior status).
export const contentStatusTransitions = pgTable(
  'content_status_transitions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
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
    index('content_status_transitions_content_idx').on(
      table.contentId,
      table.createdAt,
    ),
  ],
);

// Append-only events; rolled up to content.view_count by the Phase 6 worker.
// ip_hash is the SHA-256 of the IP + a per-tenant pepper — never store raw IP.
// public_user_id is plain uuid (not FK) so events survive user deletion.
export const contentViewEvents = pgTable(
  'content_view_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    viewedAt: timestamp('viewed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publicUserId: uuid('public_user_id'),
    ipHash: text('ip_hash'),
    referrer: text('referrer'),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('content_view_events_content_viewed_idx').on(
      table.contentId,
      table.viewedAt,
    ),
  ],
);

export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
export type ContentRevision = typeof contentRevisions.$inferSelect;
export type NewContentRevision = typeof contentRevisions.$inferInsert;
export type ContentStatusTransition =
  typeof contentStatusTransitions.$inferSelect;
export type NewContentStatusTransition =
  typeof contentStatusTransitions.$inferInsert;
export type ContentViewEvent = typeof contentViewEvents.$inferSelect;
export type NewContentViewEvent = typeof contentViewEvents.$inferInsert;
