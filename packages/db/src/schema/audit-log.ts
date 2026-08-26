import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const actorTypeEnum = pgEnum('actor_type', [
  'admin',
  'system',
  'api_key',
]);

// Append-only. Never UPDATE individual rows; never DELETE outside ops-time
// truncation/archival. No `updated_at` column, no trigger.
//
// `actor_id` and `resource_id` are intentionally NOT foreign keys: they're
// polymorphic UUIDs (actor_id can point at admin_users.id or api_keys.id
// depending on actor_type; resource_id can point at anything). Audit log
// outlives the rows it references, so keeping the UUID value when the
// target is deleted is the correct behavior.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'restrict',
    }),
    actorId: uuid('actor_id'),
    actorType: actorTypeEnum('actor_type').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    beforeSnapshot: jsonb('before_snapshot'),
    afterSnapshot: jsonb('after_snapshot'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_log_actor_idx').on(table.actorId, table.createdAt),
    index('audit_log_resource_idx').on(table.resourceType, table.resourceId),
    index('audit_log_tenant_idx').on(table.tenantId),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
