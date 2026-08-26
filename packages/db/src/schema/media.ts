import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { adminUsers } from './users.js';

export const mediaProcessingStatus = pgEnum('media_processing_status', [
  'pending',
  'processing',
  'ready',
  'failed',
]);

// Self-referential folder hierarchy. Orphan children on parent delete
// (parent_id SET NULL) rather than cascading the subtree.
export const mediaFolders = pgTable(
  'media_folders',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => mediaFolders.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('media_folders_tenant_slug_uniq').on(
      table.tenantId,
      table.slug,
    ),
    index('media_folders_parent_idx').on(table.parentId),
    index('media_folders_tenant_idx').on(table.tenantId),
  ],
);

// Master asset row. storage_key is the Garage S3 object key (NOT a URL —
// URLs are generated at query time from key + bucket config). Width/height
// are nullable since not all assets are images.
export const media = pgTable(
  'media',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    originalFilename: text('original_filename').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    altText: text('alt_text'),
    caption: text('caption'),
    folderId: uuid('folder_id').references(() => mediaFolders.id, {
      onDelete: 'set null',
    }),
    uploadedBy: uuid('uploaded_by').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    processingStatus: mediaProcessingStatus('processing_status')
      .notNull()
      .default('pending'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Globally unique storage_key — same Garage object can't be registered twice.
    uniqueIndex('media_storage_key_uniq').on(table.storageKey),
    // Queue polling: "media in this tenant with processing_status=pending".
    index('media_tenant_processing_idx').on(
      table.tenantId,
      table.processingStatus,
    ),
    index('media_tenant_idx').on(table.tenantId),
    index('media_folder_idx').on(table.folderId),
    index('media_uploaded_by_idx').on(table.uploadedBy),
  ],
);

// Generated variants (thumb_200, webp_800, etc.). Append-only — variants are
// regenerated, not updated. Cascades with the master media row.
export const mediaVariants = pgTable(
  'media_variants',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    variantKey: text('variant_key').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('media_variants_media_variant_uniq').on(
      table.mediaId,
      table.variantKey,
    ),
    uniqueIndex('media_variants_storage_key_uniq').on(table.storageKey),
    index('media_variants_media_idx').on(table.mediaId),
  ],
);

export type MediaFolder = typeof mediaFolders.$inferSelect;
export type NewMediaFolder = typeof mediaFolders.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type MediaVariant = typeof mediaVariants.$inferSelect;
export type NewMediaVariant = typeof mediaVariants.$inferInsert;
