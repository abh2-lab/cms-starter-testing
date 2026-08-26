import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { content } from './content.js';

// Named navigation menus (header/footer/sidebar). slug is the machine name the
// frontend looks up (e.g. 'main-nav', 'footer-nav').
export const menus = pgTable(
  'menus',
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
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('menus_tenant_slug_uniq')
      .on(table.tenantId, table.slug)
      .nullsNotDistinct(),
  ],
);

// A single navigation entry. parent_id is self-referential for dropdowns;
// content_id optionally links to a content row so the resolved URL tracks slug
// changes (set null on content delete so the menu item survives).
export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    menuId: uuid('menu_id')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => menuItems.id, {
      onDelete: 'set null',
    }),
    label: text('label').notNull(),
    url: text('url'),
    contentId: uuid('content_id').references(() => content.id, {
      onDelete: 'set null',
    }),
    openInNewTab: boolean('open_in_new_tab').notNull().default(false),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    attributes: jsonb('attributes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('menu_items_menu_idx').on(table.menuId),
    index('menu_items_parent_idx').on(table.parentId),
    index('menu_items_sort_order_idx').on(table.sortOrder),
  ],
);

export type Menu = typeof menus.$inferSelect;
export type NewMenu = typeof menus.$inferInsert;
export type MenuItem = typeof menuItems.$inferSelect;
export type NewMenuItem = typeof menuItems.$inferInsert;
