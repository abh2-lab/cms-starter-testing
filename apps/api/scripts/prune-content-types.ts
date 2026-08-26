/**
 * Delete named content types from a tenant — posts and all.
 *
 * Seeding only ever INSERTs/UPDATEs, it never deletes, so a content type you
 * dropped from the fixtures keeps sitting in the DB (and showing at
 * /content-types in the admin) with its old posts. This removes them for good.
 *
 * SAFE BY DEFAULT: without --confirm it is a DRY RUN — it prints exactly what it
 * would delete and changes nothing. Add --confirm to actually delete.
 *
 * Usage (NOTE: no `--` before the args — pnpm forwards a bare `--` literally):
 *   # preview:
 *   pnpm --filter @cms/api prune:content-types --tenant=<slug> <type-slug...>
 *   # apply:
 *   pnpm --filter @cms/api prune:content-types --tenant=<slug> <type-slug...> --confirm
 *
 * Example (the four stale PING types):
 *   pnpm --filter @cms/api prune:content-types --tenant=newping brands platforms publishing services --confirm
 *
 * In production (inside the deployed API container): there is no pnpm and no
 * .env file there — the env vars are already set — so call tsx directly and
 * drop --env-file (mirrors the seed command documented in apps/api/Dockerfile):
 *   cd apps/api && node_modules/.bin/tsx scripts/prune-content-types.ts \
 *     --tenant=newping brands platforms publishing services            # preview
 *   ...then add --confirm to apply.
 *
 * Guards:
 *   - Refuses to run with no tenant or no type slugs (no implicit mass delete).
 *   - System types are never touched.
 *   - A slug that doesn't exist in the tenant is reported and skipped.
 *   - Delete runs in ONE transaction: posts first (the content_type FK is
 *     ON DELETE RESTRICT), then the now-empty types. A post's own children
 *     (revisions, taxonomy links, SEO, search-index rows) are ON DELETE cascade,
 *     so they clear automatically. A failure leaves the DB untouched.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';

interface Args {
  tenantSlug: string | null;
  typeSlugs: string[];
  confirmed: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let tenantSlug: string | null = null;
  let confirmed = false;
  const typeSlugs: string[] = [];
  for (const arg of argv) {
    if (arg === '--') continue; // pnpm may forward a bare `--`; ignore it
    if (arg === '--confirm') confirmed = true;
    else if (arg.startsWith('--tenant=')) tenantSlug = arg.slice('--tenant='.length);
    else if (arg.startsWith('--')) {
      console.error(`prune:content-types — unknown flag "${arg}"`);
      process.exit(1);
    } else typeSlugs.push(arg);
  }
  if (!tenantSlug || typeSlugs.length === 0) {
    console.error(
      'prune:content-types — pass --tenant=<slug> and at least one type slug.\n' +
        '  e.g. pnpm --filter @cms/api prune:content-types --tenant=newping brands platforms --confirm',
    );
    process.exit(1);
  }
  return { tenantSlug, typeSlugs, confirmed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Resolve the tenant.
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, args.tenantSlug as string))
    .limit(1);
  if (!tenant) {
    console.error(`prune:content-types — no tenant with slug "${args.tenantSlug ?? ''}".`);
    process.exit(1);
  }

  // Find the requested types in this tenant.
  const types = await db
    .select({
      id: schema.contentTypes.id,
      slug: schema.contentTypes.slug,
      name: schema.contentTypes.name,
      isSystem: schema.contentTypes.isSystem,
    })
    .from(schema.contentTypes)
    .where(
      and(
        eq(schema.contentTypes.tenantId, tenant.id),
        inArray(schema.contentTypes.slug, args.typeSlugs),
      ),
    );

  // Report slugs that weren't found (typo / already gone / wrong tenant).
  const foundSlugs = new Set(types.map((t) => t.slug));
  for (const s of args.typeSlugs) {
    if (!foundSlugs.has(s)) {
      console.warn(`  skip  "${s}" — no such content type in tenant "${args.tenantSlug ?? ''}".`);
    }
  }
  // System types are protected.
  for (const t of types.filter((t) => t.isSystem)) {
    console.warn(`  skip  "${t.slug}" — system type, cannot delete.`);
  }

  const targets = types.filter((t) => !t.isSystem);
  if (targets.length === 0) {
    console.log('Nothing to delete.');
    process.exit(0);
  }

  // Per-type post counts for the preview.
  const targetIds = targets.map((t) => t.id);
  const countRows = await db
    .select({
      ctId: schema.content.contentTypeId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.content)
    .where(inArray(schema.content.contentTypeId, targetIds))
    .groupBy(schema.content.contentTypeId);
  const postsByType = new Map(countRows.map((r) => [r.ctId, r.n]));
  const totalPosts = targets.reduce((n, t) => n + (postsByType.get(t.id) ?? 0), 0);

  console.log(
    `\nTenant "${args.tenantSlug ?? ''}" — ${args.confirmed ? 'DELETING' : 'would delete'}:`,
  );
  for (const t of targets) {
    console.log(`  - ${t.slug.padEnd(20)} ${t.name}  (${postsByType.get(t.id) ?? 0} post(s))`);
  }
  console.log(`  = ${targets.length} type(s), ${totalPosts} post(s) total.`);

  if (!args.confirmed) {
    console.log('\nDry-run only. Re-run with --confirm to delete.');
    process.exit(0);
  }

  console.log('\nDeleting in a single transaction…');
  const deleted = await db.transaction(async (tx) => {
    const posts = (
      await tx
        .delete(schema.content)
        .where(inArray(schema.content.contentTypeId, targetIds))
        .returning({ id: schema.content.id })
    ).length;
    const removedTypes = (
      await tx
        .delete(schema.contentTypes)
        .where(
          and(
            inArray(schema.contentTypes.id, targetIds),
            eq(schema.contentTypes.isSystem, false),
          ),
        )
        .returning({ id: schema.contentTypes.id })
    ).length;
    return { posts, removedTypes };
  });
  console.log(`Deleted ${deleted.posts} post(s) and ${deleted.removedTypes} type(s).`);

  // Show what's left so the result is obvious.
  const remaining = await db
    .select({ slug: schema.contentTypes.slug, name: schema.contentTypes.name })
    .from(schema.contentTypes)
    .where(eq(schema.contentTypes.tenantId, tenant.id))
    .orderBy(schema.contentTypes.name);
  console.log('\nContent types remaining in this tenant:');
  for (const t of remaining) console.log(`  - ${t.slug.padEnd(20)} ${t.name}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('prune:content-types — failed:', err);
  process.exit(1);
});
