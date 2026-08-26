import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { content } from './content.js';

// Tracks "what we indexed into Meilisearch and when" so the nightly full
// re-index job can detect drift between Postgres and Meilisearch.
// checksum is a hash of the indexed document — re-index only fires when
// the stored checksum differs from the current content's checksum.
// Append-only — no updated_at. CASCADEs when the content row is deleted.
export const searchIndexLog = pgTable(
  'search_index_log',
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
    indexedAt: timestamp('indexed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    indexName: text('index_name').notNull(),
    checksum: text('checksum').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Lookups: latest index state for a content row across indexes.
    index('search_index_log_content_idx').on(
      table.contentId,
      table.indexedAt,
    ),
    index('search_index_log_index_name_idx').on(table.indexName),
  ],
);

export type SearchIndexLogEntry = typeof searchIndexLog.$inferSelect;
export type NewSearchIndexLogEntry = typeof searchIndexLog.$inferInsert;
