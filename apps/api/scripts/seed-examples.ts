/**
 * Seed generic news sample data for local testing.
 *
 * Run: `pnpm --filter @cms/api seed:examples`
 *
 * What it does (scoped to the `test-tenant` only):
 *  1. Ensures the tenant + a super_admin (admin@test.com / test1234) exist.
 *  2. Calls the shared loadSampleData service to seed content types,
 *     taxonomies, terms, posts, menus, and redirects. Idempotent — re-running
 *     is safe and only inserts rows that don't already exist.
 *  3. Writes site_settings if missing.
 *
 * The same `loadSampleData` is used by the First Boot Experience setup
 * wizard, so any change to the demo dataset shows up in both places.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { hashPassword } from '../src/services/password.js';
import { loadSampleData } from '../src/services/sample-data.js';

const TENANT_SLUG = 'test-tenant';
const ADMIN_EMAIL = 'admin@test.com';
const ADMIN_PASSWORD = 'test1234';

async function ensureTenantAndAdmin(): Promise<string> {
  await db
    .insert(schema.tenants)
    .values({ name: 'Test Tenant', slug: TENANT_SLUG })
    .onConflictDoNothing();
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, TENANT_SLUG))
    .limit(1);
  if (!tenant) throw new Error('Failed to resolve tenant');

  await db
    .insert(schema.adminUsers)
    .values({
      email: ADMIN_EMAIL,
      hashedPassword: await hashPassword(ADMIN_PASSWORD),
      displayName: 'Test Admin',
      role: 'super_admin',
      tenantId: tenant.id,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: schema.adminUsers.email,
      set: { isActive: true },
    });

  return tenant.id;
}

async function ensureSiteSettings(tenantId: string): Promise<void> {
  const existing = await db
    .select({ id: schema.siteSettings.id })
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.tenantId, tenantId))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(schema.siteSettings).values({
    tenantId,
    siteName: 'Community Daily',
    siteUrl: 'http://localhost:3001',
    siteDescription: 'A demo community publication seeded by the example script.',
    defaultMetaTitleSuffix: ' | Community Daily',
    defaultRobots: 'index,follow',
    contactEmail: 'editor@example.test',
  });
}

async function main(): Promise<void> {
  const tenantId = await ensureTenantAndAdmin();
  console.log(`Tenant: ${tenantId}`);
  console.log('Seeding demo data via loadSampleData…');
  const result = await loadSampleData({ tenantId });
  await ensureSiteSettings(tenantId);
  console.log(`Done. Inserted in this run:
  - content types: ${result.contentTypes}
  - taxonomies:    ${result.taxonomies}
  - terms:         ${result.taxonomyTerms}
  - posts:         ${result.posts}
  - reviews:       ${result.reviews}
  - menus:         ${result.menus}
  - redirects:     ${result.redirects}
  - static pages:  ${result.pages}
  - home page:     ${result.homePage}

Login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}
`);
  process.exit(0);
}

void main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
