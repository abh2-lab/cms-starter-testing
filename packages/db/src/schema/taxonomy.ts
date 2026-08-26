import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { content } from './content.js';

// Explicit Category-vs-Tag classification. Replaces the overloaded
// `isHierarchical` boolean as the discriminator (which only ever meant
// "supports parent/child nesting" and silently mislabeled flat categories
// as tags). `isHierarchical` stays on the row but only matters when
// kind = 'category'; it's ignored for 'tag' and rejected as `true` at
// validation time (see apps/api/src/routes/admin/taxonomies.ts).
export const taxonomyKindEnum = pgEnum('taxonomy_kind', ['category', 'tag']);

export const taxonomies = pgTable(
  'taxonomies',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // Plain-language summary of what this taxonomy is for. Optional — surfaces
    // on the public /category/<slug> and /tag/<slug> hero rows when set, and
    // falls back to nothing otherwise. Mirrors taxonomy_terms.description.
    description: text('description'),
    // Defaults to 'category' so the migration is the safe "everything becomes
    // a category" backfill — flat-but-conceptually-category taxonomies don't
    // get silently mislabeled as tags. Admins flip the real tags via the UI
    // toggle after the migration runs.
    kind: taxonomyKindEnum('kind').notNull().default('category'),
    isHierarchical: boolean('is_hierarchical').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('taxonomies_tenant_slug_uniq')
      .on(table.tenantId, table.slug)
      .nullsNotDistinct(),
    index('taxonomies_tenant_idx').on(table.tenantId),
  ],
);

// Self-referential via parent_id. Orphan children on parent delete (set null)
// rather than cascading — a deleted parent shouldn't silently delete its
// subtree.
export const taxonomyTerms = pgTable(
  'taxonomy_terms',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    taxonomyId: uuid('taxonomy_id')
      .notNull()
      .references(() => taxonomies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => taxonomyTerms.id,
      { onDelete: 'set null' },
    ),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Doubles as the "term lookup by slug within taxonomy" index from the spec.
    uniqueIndex('taxonomy_terms_taxonomy_slug_uniq').on(
      table.taxonomyId,
      table.slug,
    ),
    index('taxonomy_terms_parent_idx').on(table.parentId),
  ],
);

// Junction table. Composite PK on (content_id, term_id) prevents duplicate
// associations. No tenant_id needed — tenancy flows through both FKs.
export const contentTaxonomyTerms = pgTable(
  'content_taxonomy_terms',
  {
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => taxonomyTerms.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.contentId, table.termId] }),
    // Reverse lookup: "which content has this term?"
    index('content_taxonomy_terms_term_idx').on(table.termId),
  ],
);

export type Taxonomy = typeof taxonomies.$inferSelect;
export type NewTaxonomy = typeof taxonomies.$inferInsert;
export type TaxonomyTerm = typeof taxonomyTerms.$inferSelect;
export type NewTaxonomyTerm = typeof taxonomyTerms.$inferInsert;
export type ContentTaxonomyTerm = typeof contentTaxonomyTerms.$inferSelect;
export type NewContentTaxonomyTerm = typeof contentTaxonomyTerms.$inferInsert;
