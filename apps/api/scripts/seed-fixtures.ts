/**
 * Seed a fixture set into a tenant.
 *
 * Usage:
 *   pnpm --filter @cms/api seed:fixtures              # name=example, tenant=test-tenant
 *   pnpm --filter @cms/api seed:fixtures -- mypub     # name=mypub, tenant=test-tenant
 *   pnpm --filter @cms/api seed:fixtures -- mypub --tenant=acme
 *
 * Reads JSON files from apps/api/fixtures/<name>/, validates them against the
 * block / template registries and zod schemas, and inserts rows via the
 * shared loader. Idempotent — re-running is safe and only reports NEW
 * inserts (existing rows may still be updated for structural fixtures).
 *
 * Auto-creates the tenant if missing (mirrors seed-examples.ts). Does NOT
 * create admin users — use seed:test-admin for that.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { reloadStorageClients } from '../src/lib/s3.js';
import {
  FixtureValidationError,
  loadFixtures,
  type FixtureLoadResult,
} from '../src/services/fixture-loader/index.js';

const DEFAULT_FIXTURE_NAME = 'example';
const DEFAULT_TENANT_SLUG = 'test-tenant';

interface ParsedArgs {
  name: string;
  tenantSlug: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let name = DEFAULT_FIXTURE_NAME;
  let tenantSlug = DEFAULT_TENANT_SLUG;
  for (const arg of argv) {
    if (arg.startsWith('--tenant=')) {
      tenantSlug = arg.slice('--tenant='.length);
    } else if (!arg.startsWith('--')) {
      name = arg;
    } else {
      console.error(`seed:fixtures — unknown flag "${arg}"`);
      process.exit(1);
    }
  }
  if (name.length === 0 || tenantSlug.length === 0) {
    console.error('seed:fixtures — name and --tenant must be non-empty');
    process.exit(1);
  }
  return { name, tenantSlug };
}

async function ensureTenant(slug: string): Promise<string> {
  await db
    .insert(schema.tenants)
    .values({ name: slug, slug })
    .onConflictDoNothing({ target: schema.tenants.slug });
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    throw new Error(`Failed to resolve tenant after upsert: ${slug}`);
  }
  return tenant.id;
}

function printResult(result: FixtureLoadResult): void {
  console.log(`
Done. Newly inserted in this run:
  - media:                ${result.media}
  - content types:        ${result.contentTypes}
  - taxonomies:           ${result.taxonomies}
  - taxonomy terms:       ${result.taxonomyTerms}
  - posts:                ${result.posts}
  - post SEO rows:        ${result.postSeo}
  - post taxonomy links:  ${result.postTermLinks}
  - pages:                ${result.pages}
  - page templates:       ${result.pageTemplates}
  - menus:                ${result.menus}
  - menu items:           ${result.menuItems}
  - redirects:            ${result.redirects}
  - site settings:        ${result.siteSettingsWritten ? 'inserted' : 'unchanged or updated'}

Zero counts on re-run = idempotent (structural rows may have been UPDATEd in place).
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Resolve fixtures dir relative to this script — works both when run from
  // tsx in dev (scripts/) and when built (dist/scripts/).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturesDir = path.resolve(here, '..', 'fixtures', args.name);

  console.log(`seed:fixtures — fixture="${args.name}" tenant="${args.tenantSlug}"`);
  console.log(`seed:fixtures — fixtures dir: ${fixturesDir}`);

  const tenantId = await ensureTenant(args.tenantSlug);
  console.log(`seed:fixtures — tenant id: ${tenantId}`);

  // Initialise the S3 client singletons so seed-media can upload to the bucket
  // configured for this tenant. Idempotent — re-initialising with the same
  // config is a no-op. Skipping this would leave the singletons unset and the
  // first PutObject call would throw "S3 clients not initialised".
  await reloadStorageClients(tenantId);

  const start = Date.now();
  const result = await loadFixtures({ tenantId, fixturesDir });
  console.log(`seed:fixtures — completed in ${Date.now() - start}ms`);

  printResult(result);
  process.exit(0);
}

main().catch((err: unknown) => {
  if (err instanceof FixtureValidationError) {
    console.error(`seed:fixtures — validation failed:\n${err.message}`);
    process.exit(1);
  }
  console.error('seed:fixtures — failed:', err);
  process.exit(1);
});
