import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { content } from './content.js';

// Extended SEO metadata, one row per content row. Split out of `content` so the
// SEO surface can grow independently of the core content row. Image fields store
// S3 object keys only — never full URLs. meta_description length (160) is
// enforced at the app layer, not the DB.
export const contentSeo = pgTable(
  'content_seo',
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
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    metaKeywords: text('meta_keywords').array(),
    ogTitle: text('og_title'),
    ogDescription: text('og_description'),
    ogImageKey: text('og_image_key'),
    ogType: text('og_type').default('article'),
    twitterCard: text('twitter_card').default('summary_large_image'),
    twitterTitle: text('twitter_title'),
    twitterDescription: text('twitter_description'),
    twitterImageKey: text('twitter_image_key'),
    canonicalUrl: text('canonical_url'),
    robotsIndex: boolean('robots_index').notNull().default(true),
    robotsFollow: boolean('robots_follow').notNull().default(true),
    sitemapInclude: boolean('sitemap_include').notNull().default(true),
    sitemapPriority: numeric('sitemap_priority', { precision: 2, scale: 1 }),
    sitemapChangeFreq: text('sitemap_change_freq'),
    schemaType: text('schema_type'),
    schemaOverrides: jsonb('schema_overrides'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('content_seo_content_id_uniq').on(table.contentId),
  ],
);

export type ContentSeo = typeof contentSeo.$inferSelect;
export type NewContentSeo = typeof contentSeo.$inferInsert;
