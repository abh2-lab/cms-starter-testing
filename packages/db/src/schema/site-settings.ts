import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// Global per-tenant configuration. One row per tenant (or a single NULL-tenant
// row in single-tenant mode). Image fields store S3 object keys only.
// custom_*_scripts are raw HTML injected into the page — treated as trusted
// publisher input, sanitized/escaped at render time as appropriate.
export const siteSettings = pgTable(
  'site_settings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    siteName: text('site_name').notNull(),
    siteDescription: text('site_description'),
    siteUrl: text('site_url').notNull(),
    logoKey: text('logo_key'),
    faviconKey: text('favicon_key'),
    defaultOgImageKey: text('default_og_image_key'),
    contactEmail: text('contact_email'),
    socialLinks: jsonb('social_links'),
    defaultMetaTitleSuffix: text('default_meta_title_suffix'),
    defaultRobots: text('default_robots').notNull().default('index,follow'),
    googleSiteVerification: text('google_site_verification'),
    analyticsId: text('analytics_id'),
    commentsEnabled: boolean('comments_enabled').notNull().default(false),
    registrationEnabled: boolean('registration_enabled')
      .notNull()
      .default(false),
    maintenanceMode: boolean('maintenance_mode').notNull().default(false),
    customHeadScripts: text('custom_head_scripts'),
    customBodyScripts: text('custom_body_scripts'),
    extra: jsonb('extra'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One settings row per tenant. nullsNotDistinct so single-tenant mode is
    // limited to exactly one NULL-tenant row.
    unique('site_settings_tenant_id_uniq')
      .on(table.tenantId)
      .nullsNotDistinct(),
  ],
);

export type SiteSettings = typeof siteSettings.$inferSelect;
export type NewSiteSettings = typeof siteSettings.$inferInsert;
