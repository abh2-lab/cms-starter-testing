/**
 * Wipe the content side of the database so you can re-run `seed:fixtures`
 * from a clean slate.
 *
 * Usage:
 *   pnpm --filter @cms/api wipe:content --tenant=<slug>              # dry-run, one tenant
 *   pnpm --filter @cms/api wipe:content --tenant=<slug> --confirm    # apply, one tenant
 *   pnpm --filter @cms/api wipe:content --all-tenants                # dry-run, every tenant
 *   pnpm --filter @cms/api wipe:content --all-tenants --confirm      # apply, every tenant
 *
 * Deletes ONLY these tables (in FK-safe order):
 *   - content                  (cascades revisions, transitions, view events,
 *                               SEO, taxonomy links)
 *   - content_types
 *   - pages                    (cascades revisions, transitions)
 *   - page_templates
 *   - taxonomies               (cascades terms)
 *
 * Leaves intact:
 *   - tenant rows + admin users (no login disruption)
 *   - media + media_folders     (re-seed reuses by content-hash)
 *   - menus + menu_items, redirects, site_settings, *_settings rows
 *
 * Wrapped in a single transaction so the wipe is atomic. Refuses to run
 * without --confirm. Refuses to run without either --tenant=<slug> or
 * --all-tenants — no implicit "wipe everything" mode.
 */
import { inArray } from 'drizzle-orm';
import { db, schema } from '@cms/db';

interface Args {
  tenantSlug: string | null;
  allTenants: boolean;
  confirmed: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let tenantSlug: string | null = null;
  let allTenants = false;
  let confirmed = false;
  for (const arg of argv) {
    if (arg.startsWith('--tenant=')) {
      tenantSlug = arg.slice('--tenant='.length);
    } else if (arg === '--all-tenants') {
      allTenants = true;
    } else if (arg === '--confirm') {
      confirmed = true;
    } else {
      console.error(`wipe:content — unknown argument "${arg}"`);
      process.exit(1);
    }
  }
  if (!tenantSlug && !allTenants) {
    console.error(
      'wipe:content — pass --tenant=<slug> OR --all-tenants. Refusing to run with no scope.',
    );
    process.exit(1);
  }
  if (tenantSlug && allTenants) {
    console.error(
      'wipe:content — pass either --tenant=<slug> or --all-tenants, not both.',
    );
    process.exit(1);
  }
  return { tenantSlug, allTenants, confirmed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Resolve which tenants are in scope.
  const allTenants = await db
    .select({ id: schema.tenants.id, slug: schema.tenants.slug })
    .from(schema.tenants);
  if (allTenants.length === 0) {
    console.log('wipe:content — no tenants in the DB; nothing to wipe.');
    process.exit(0);
  }
  const targets = args.allTenants
    ? allTenants
    : allTenants.filter((t) => t.slug === args.tenantSlug);
  if (targets.length === 0) {
    console.error(
      `wipe:content — no tenant with slug "${args.tenantSlug ?? ''}". Known tenants:`,
    );
    for (const t of allTenants) console.error(`  - ${t.slug}`);
    process.exit(1);
  }
  const tenantIds = targets.map((t) => t.id);

  console.log(
    `wipe:content — scope: ${args.allTenants ? 'ALL TENANTS' : `tenant "${args.tenantSlug ?? ''}"`}`,
  );
  console.log(`  tenants in scope: ${targets.map((t) => t.slug).join(', ')}`);

  const counts = await collectCounts(tenantIds);
  console.log('\nPreview (rows that will be deleted on apply):');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  if (!args.confirmed) {
    console.log('\nDry-run only. Re-run with --confirm to apply.');
    process.exit(0);
  }

  console.log('\nApplying wipe in a single transaction…');
  const deleted = await db.transaction(async (tx) => {
    // content first — its FK cascades clean up content_seo,
    // content_taxonomy_terms, content_revisions, content_status_transitions,
    // content_view_events. After that, content_types can drop safely.
    const content = (
      await tx
        .delete(schema.content)
        .where(inArray(schema.content.tenantId, tenantIds))
        .returning({ id: schema.content.id })
    ).length;

    const contentTypes = (
      await tx
        .delete(schema.contentTypes)
        .where(inArray(schema.contentTypes.tenantId, tenantIds))
        .returning({ id: schema.contentTypes.id })
    ).length;

    // pages cascades page_revisions + page_status_transitions.
    const pages = (
      await tx
        .delete(schema.pages)
        .where(inArray(schema.pages.tenantId, tenantIds))
        .returning({ id: schema.pages.id })
    ).length;

    const pageTemplates = (
      await tx
        .delete(schema.pageTemplates)
        .where(inArray(schema.pageTemplates.tenantId, tenantIds))
        .returning({ id: schema.pageTemplates.id })
    ).length;

    // taxonomies cascade taxonomy_terms (terms also lose any content_taxonomy_terms,
    // but content was already deleted above so those links are gone anyway).
    const taxonomies = (
      await tx
        .delete(schema.taxonomies)
        .where(inArray(schema.taxonomies.tenantId, tenantIds))
        .returning({ id: schema.taxonomies.id })
    ).length;

    return { content, contentTypes, pages, pageTemplates, taxonomies };
  });

  console.log('\nDeleted:');
  for (const [k, v] of Object.entries(deleted)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  console.log(
    `\nClean slate ${args.allTenants ? 'across every tenant' : `for "${args.tenantSlug ?? ''}"`}. Re-seed with: pnpm --filter @cms/api seed:fixtures <name> --tenant=<slug>`,
  );
  process.exit(0);
}

async function collectCounts(
  tenantIds: readonly string[],
): Promise<Record<string, number>> {
  const content = await db
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(inArray(schema.content.tenantId, tenantIds));
  const contentTypes = await db
    .select({ id: schema.contentTypes.id })
    .from(schema.contentTypes)
    .where(inArray(schema.contentTypes.tenantId, tenantIds));
  const pages = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(inArray(schema.pages.tenantId, tenantIds));
  const pageTemplates = await db
    .select({ id: schema.pageTemplates.id })
    .from(schema.pageTemplates)
    .where(inArray(schema.pageTemplates.tenantId, tenantIds));
  const taxonomies = await db
    .select({ id: schema.taxonomies.id })
    .from(schema.taxonomies)
    .where(inArray(schema.taxonomies.tenantId, tenantIds));

  return {
    content: content.length,
    content_types: contentTypes.length,
    pages: pages.length,
    page_templates: pageTemplates.length,
    taxonomies: taxonomies.length,
  };
}

main().catch((err: unknown) => {
  console.error('wipe:content — failed:', err);
  process.exit(1);
});
