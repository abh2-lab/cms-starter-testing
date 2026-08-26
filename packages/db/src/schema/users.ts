import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const adminRole = pgEnum('admin_role', [
  'super_admin',
  'admin',
  'editor',
  'author',
  'viewer',
]);

// admin_users.email is GLOBALLY unique (super_admins have null tenant_id and
// must not collide with tenant-scoped admin emails). Reasoning: an admin
// account is a privileged identity; the same human shouldn't be silently
// reused across tenants under one email.
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    email: text('email').notNull().unique(),
    hashedPassword: text('hashed_password').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    role: adminRole('role').notNull().default('viewer'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    // True for the bootstrap super_admin created by the First Boot Experience.
    // Protected users cannot be deleted, deactivated, or demoted via the API —
    // guarantees there is always one functioning super_admin.
    isProtected: boolean('is_protected').notNull().default(false),
    // Null until the user finishes or skips the welcome tour. Set once; the
    // dashboard auto-trigger only runs while this is null.
    tourCompletedAt: timestamp('tour_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('admin_users_tenant_idx').on(table.tenantId)],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('admin_sessions_user_idx').on(table.userId),
    // Index for the "delete expired sessions" sweep job.
    index('admin_sessions_expires_idx').on(table.expiresAt),
  ],
);

// public_users.email is unique PER TENANT — same email can have separate
// accounts on tenant A and tenant B. tenantId is NOT NULL so NULLS handling
// is moot, but we still use a composite unique index.
export const publicUsers = pgTable(
  'public_users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    hashedPassword: text('hashed_password').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('public_users_tenant_email_uniq').on(
      table.tenantId,
      table.email,
    ),
    index('public_users_tenant_idx').on(table.tenantId),
  ],
);

export const publicSessions = pgTable(
  'public_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => publicUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('public_sessions_user_idx').on(table.userId),
    index('public_sessions_expires_idx').on(table.expiresAt),
  ],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type AdminSession = typeof adminSessions.$inferSelect;
export type NewAdminSession = typeof adminSessions.$inferInsert;
export type PublicUser = typeof publicUsers.$inferSelect;
export type NewPublicUser = typeof publicUsers.$inferInsert;
export type PublicSession = typeof publicSessions.$inferSelect;
export type NewPublicSession = typeof publicSessions.$inferInsert;
