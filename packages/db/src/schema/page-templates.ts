import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { adminUsers } from './users.js';

// User-saved Page Templates. Coexists with the code-shipped templates in
// packages/blocks/src/templates/*: those ship in code and are immutable; rows
// here are tenant-scoped, admin-authored, and editable. The `GET
// /admin/page-templates` endpoint merges both sources into a single response.
//
// Captures ARRANGEMENT ONLY — an ordered list of block keys. Field values
// (titles, eyebrows, bindings) are intentionally NOT saved: a template is a
// starting layout, not a starting draft. When the admin loads a template into
// the dynamic page builder, each block_key is expanded into a fresh instance
// with the block's own default field values.
//
// `key` is the URL-friendly slug derived from `name` on POST; collisions with
// code-shipped keys (home-default, static-textpage) are suffixed `-user-N` by
// the route handler. Soft-delete via `deleted_at` so a template that pages
// were created from stays auditable even after the editor "removes" it.
export const pageTemplates = pgTable(
  'page_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    // Ordered array of block_key strings. JSONB (not text[]) for two reasons:
    //   1. matches the shape that flows over HTTP to the admin verbatim
    //   2. cheap to add per-row metadata later (e.g. {block_key, locked: true})
    //      without DDL
    blockKeys: jsonb('block_keys').notNull().default(sql`'[]'::jsonb`),
    authorId: uuid('author_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('page_templates_tenant_key_uniq')
      .on(table.tenantId, table.key)
      .nullsNotDistinct(),
    index('page_templates_tenant_updated_idx').on(
      table.tenantId,
      table.updatedAt,
    ),
  ],
);

export type PageTemplate = typeof pageTemplates.$inferSelect;
export type NewPageTemplate = typeof pageTemplates.$inferInsert;
