import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FieldDefinitions } from '@cms/types';
import { tenants } from './tenants.js';

// Who may submit content of this type via the public submission endpoint:
//   none          — submissions closed (default; same as before this feature)
//   authenticated — only logged-in users (any admin role)
//   public        — anyone, including anonymous guests
export const submissionAccess = pgEnum('submission_access', [
  'none',
  'authenticated',
  'public',
]);

// A content_type defines the shape (custom fields) of content rows.
// system types (is_system=true) cannot be deleted; they ship with the
// platform. tenant_id is nullable so a super_admin can register a global
// content_type that all tenants share.
export const contentTypes = pgTable(
  'content_types',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    icon: text('icon'),
    isSystem: boolean('is_system').notNull().default(false),
    fieldDefinitions: jsonb('field_definitions')
      .$type<FieldDefinitions>()
      .notNull()
      .default(sql`'{"fields":[]}'::jsonb`),
    settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
    // Per-tenant template for the public-site URL where an item of this type
    // is rendered, with `{slug}` substituted at preview time. Example:
    // `/article/{slug}`, `/news/{slug}`. NULL = preview not configured; the
    // admin shows a "configure this on the content type" message. The actual
    // public route must exist in apps/web — editors can break previews by
    // pointing at a non-existent path.
    previewPath: text('preview_path'),
    // Public submission access level for this content type (see submissionAccess
    // enum above). Defaults to 'none' so existing types accept no submissions.
    submissionAccess: submissionAccess('submission_access')
      .notNull()
      .default('none'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // NULLS NOT DISTINCT so two system-type rows can't share a slug even
    // though both have NULL tenant_id (Pg default treats NULLs as distinct).
    unique('content_types_tenant_slug_uniq')
      .on(table.tenantId, table.slug)
      .nullsNotDistinct(),
    index('content_types_tenant_idx').on(table.tenantId),
  ],
);

export type ContentType = typeof contentTypes.$inferSelect;
export type NewContentType = typeof contentTypes.$inferInsert;
