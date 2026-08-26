import { sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';

export { db, schema };

/**
 * Truncate the listed tables (CASCADE handles FK chains). The order doesn't
 * matter with CASCADE; just list every table the test touches.
 */
export async function truncate(tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  const joined = tables.join(', ');
  await db.execute(sql.raw(`TRUNCATE ${joined} RESTART IDENTITY CASCADE`));
}

/**
 * Insert a deterministic test tenant + content_type. Idempotent via
 * onConflictDoNothing so tests can call this in beforeEach after a TRUNCATE.
 * Returns the seeded ids for use in subsequent inserts.
 */
export interface SeedBaseResult {
  tenantId: string;
  contentTypeId: string;
}

export async function seedBase(args: {
  tenantId: string;
  contentTypeId: string;
}): Promise<SeedBaseResult> {
  await db
    .insert(schema.tenants)
    .values({
      id: args.tenantId,
      name: 'Integration Test Tenant',
      slug: 'integration-test',
    })
    .onConflictDoNothing();
  await db
    .insert(schema.contentTypes)
    .values({
      id: args.contentTypeId,
      tenantId: args.tenantId,
      name: 'Article',
      slug: 'article',
    })
    .onConflictDoNothing();
  return { tenantId: args.tenantId, contentTypeId: args.contentTypeId };
}
