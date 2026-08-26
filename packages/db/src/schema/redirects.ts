import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// 301/302 redirect map. from_path is the old path; to_path may be a path or a
// full URL. auto_created flags redirects the system inserts when a content slug
// changes. hit_count / last_hit_at are maintained by the redirect middleware.
export const redirects = pgTable(
  'redirects',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    fromPath: text('from_path').notNull(),
    toPath: text('to_path').notNull(),
    redirectType: integer('redirect_type').notNull().default(301),
    isActive: boolean('is_active').notNull().default(true),
    hitCount: integer('hit_count').notNull().default(0),
    lastHitAt: timestamp('last_hit_at', { withTimezone: true }),
    notes: text('notes'),
    autoCreated: boolean('auto_created').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // No duplicate source paths per tenant. nullsNotDistinct so the single-tenant
    // (NULL tenant) case still rejects duplicate from_path values.
    unique('redirects_tenant_from_path_uniq')
      .on(table.tenantId, table.fromPath)
      .nullsNotDistinct(),
    index('redirects_from_path_idx').on(table.fromPath),
    index('redirects_is_active_idx').on(table.isActive),
  ],
);

export type Redirect = typeof redirects.$inferSelect;
export type NewRedirect = typeof redirects.$inferInsert;
