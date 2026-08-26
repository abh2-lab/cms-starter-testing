/**
 * Fold the database to a single canonical tenant.
 *
 * Usage:
 *   pnpm --filter @cms/api fold:single-tenant --keep=<slug>              # dry-run
 *   pnpm --filter @cms/api fold:single-tenant --keep=<slug> --confirm    # apply
 *
 * Deletes every tenant whose slug != --keep, plus every row that references
 * those tenants in any tenant-scoped table. Super_admin users attached to a
 * deleted tenant are moved to the kept tenant first so the operator never
 * loses their login. Non-super_admin users attached to a deleted tenant are
 * removed (they were tenant-specific).
 *
 * Idempotent: re-running on a DB that already has only the kept tenant
 * reports "Nothing to fold" and exits 0.
 *
 * Why this exists: the schema was originally shaped for a SaaS variant with
 * many tenants per install; in single-publisher mode the extra tenants are
 * dev sandboxes that clutter the admin UI and force per-tenant logins. After
 * folding, there is one tenant in the DB and one super_admin can see and
 * manage everything.
 *
 * Safety:
 * - Refuses to run without --confirm
 * - Refuses to run if --keep doesn't match an existing tenant
 * - Wraps every delete in a single transaction (atomic)
 * - Prints a per-table dry-run summary before any write when --confirm is absent
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db, schema } from '@cms/db';

interface Args {
  keep: string;
  confirmed: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let keep: string | undefined;
  let confirmed = false;
  for (const arg of argv) {
    if (arg.startsWith('--keep=')) {
      keep = arg.slice('--keep='.length);
    } else if (arg === '--confirm') {
      confirmed = true;
    } else {
      console.error(`fold:single-tenant — unknown argument "${arg}"`);
      process.exit(1);
    }
  }
  if (!keep || keep.length === 0) {
    console.error('fold:single-tenant — --keep=<slug> is required');
    process.exit(1);
  }
  return { keep, confirmed };
}

interface TenantRow {
  id: string;
  slug: string;
}

interface TableDelete {
  // Human-readable name for the report. Most match the schema column except
  // where the cascaded children are reported separately.
  name: string;
  // Drizzle pgTable. The function is generic over PgTable<{tenantId: column}>
  // so we don't repeat the same WHERE clause shape per table.
  table: { tenantId: typeof schema.content.tenantId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const [keepTenant] = await db
    .select({ id: schema.tenants.id, slug: schema.tenants.slug })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, args.keep))
    .limit(1);

  if (!keepTenant) {
    console.error(
      `fold:single-tenant — no active tenant with slug "${args.keep}". Existing tenants:`,
    );
    const all = await db
      .select({ slug: schema.tenants.slug })
      .from(schema.tenants);
    for (const t of all) console.error(`  - ${t.slug}`);
    process.exit(1);
  }

  const others: TenantRow[] = await db
    .select({ id: schema.tenants.id, slug: schema.tenants.slug })
    .from(schema.tenants)
    .where(ne(schema.tenants.slug, args.keep));

  if (others.length === 0) {
    console.log(
      `fold:single-tenant — only tenant is "${keepTenant.slug}", nothing to fold.`,
    );
    process.exit(0);
  }

  const victimIds = others.map((t) => t.id);

  // Per-table counts of rows that WILL be deleted (or moved, for admins).
  // Collected up front so a --confirm-less run can preview the impact.
  const previewCounts = await collectPreviewCounts(victimIds);

  console.log(
    `fold:single-tenant — keep="${keepTenant.slug}", fold="${others
      .map((t) => t.slug)
      .join(', ')}"`,
  );
  console.log('\nPreview (rows affected on apply):');
  printPreview(previewCounts);

  if (!args.confirmed) {
    console.log(`\nDry-run only. Re-run with --confirm to apply.`);
    process.exit(0);
  }

  console.log('\nApplying fold in a single transaction…');
  const result = await db.transaction(async (tx) => {
    // Step 1: move super_admins out of victim tenants to the kept tenant so
    // we never accidentally lock the operator out of their own DB.
    const moved = await tx
      .update(schema.adminUsers)
      .set({ tenantId: keepTenant.id })
      .where(
        and(
          inArray(schema.adminUsers.tenantId, victimIds),
          eq(schema.adminUsers.role, 'super_admin'),
        ),
      )
      .returning({ email: schema.adminUsers.email });

    // Step 2: delete every tenant-scoped row. Order matters — tables whose
    // children cascade are deleted before the children's parent constraint
    // can fire elsewhere. Pure manual tables (audit_log, webhooks, etc.) go
    // first so they can't keep the tenant row alive.
    const deletes: Record<string, number> = {};

    deletes['audit_log'] = (
      await tx
        .delete(schema.auditLog)
        .where(inArray(schema.auditLog.tenantId, victimIds))
        .returning({ id: schema.auditLog.id })
    ).length;

    deletes['webhooks'] = (
      await tx
        .delete(schema.webhooks)
        .where(inArray(schema.webhooks.tenantId, victimIds))
        .returning({ id: schema.webhooks.id })
    ).length;

    deletes['search_index_log'] = (
      await tx
        .delete(schema.searchIndexLog)
        .where(inArray(schema.searchIndexLog.tenantId, victimIds))
        .returning({ id: schema.searchIndexLog.id })
    ).length;

    deletes['content'] = (
      await tx
        .delete(schema.content)
        .where(inArray(schema.content.tenantId, victimIds))
        .returning({ id: schema.content.id })
    ).length;

    deletes['content_types'] = (
      await tx
        .delete(schema.contentTypes)
        .where(inArray(schema.contentTypes.tenantId, victimIds))
        .returning({ id: schema.contentTypes.id })
    ).length;

    deletes['taxonomies'] = (
      await tx
        .delete(schema.taxonomies)
        .where(inArray(schema.taxonomies.tenantId, victimIds))
        .returning({ id: schema.taxonomies.id })
    ).length;

    deletes['pages'] = (
      await tx
        .delete(schema.pages)
        .where(inArray(schema.pages.tenantId, victimIds))
        .returning({ id: schema.pages.id })
    ).length;

    deletes['menus'] = (
      await tx
        .delete(schema.menus)
        .where(inArray(schema.menus.tenantId, victimIds))
        .returning({ id: schema.menus.id })
    ).length;

    deletes['site_settings'] = (
      await tx
        .delete(schema.siteSettings)
        .where(inArray(schema.siteSettings.tenantId, victimIds))
        .returning({ id: schema.siteSettings.id })
    ).length;

    deletes['email_settings'] = (
      await tx
        .delete(schema.emailSettings)
        .where(inArray(schema.emailSettings.tenantId, victimIds))
        .returning({ id: schema.emailSettings.id })
    ).length;

    deletes['storage_settings'] = (
      await tx
        .delete(schema.storageSettings)
        .where(inArray(schema.storageSettings.tenantId, victimIds))
        .returning({ id: schema.storageSettings.id })
    ).length;

    deletes['monitoring_settings'] = (
      await tx
        .delete(schema.monitoringSettings)
        .where(inArray(schema.monitoringSettings.tenantId, victimIds))
        .returning({ id: schema.monitoringSettings.id })
    ).length;

    deletes['system_settings'] = (
      await tx
        .delete(schema.systemSettings)
        .where(inArray(schema.systemSettings.tenantId, victimIds))
        .returning({ id: schema.systemSettings.id })
    ).length;

    deletes['media'] = (
      await tx
        .delete(schema.media)
        .where(inArray(schema.media.tenantId, victimIds))
        .returning({ id: schema.media.id })
    ).length;

    deletes['media_folders'] = (
      await tx
        .delete(schema.mediaFolders)
        .where(inArray(schema.mediaFolders.tenantId, victimIds))
        .returning({ id: schema.mediaFolders.id })
    ).length;

    deletes['api_keys'] = (
      await tx
        .delete(schema.apiKeys)
        .where(inArray(schema.apiKeys.tenantId, victimIds))
        .returning({ id: schema.apiKeys.id })
    ).length;

    deletes['public_users'] = (
      await tx
        .delete(schema.publicUsers)
        .where(inArray(schema.publicUsers.tenantId, victimIds))
        .returning({ id: schema.publicUsers.id })
    ).length;

    deletes['admin_users (non-super_admin)'] = (
      await tx
        .delete(schema.adminUsers)
        .where(inArray(schema.adminUsers.tenantId, victimIds))
        .returning({ email: schema.adminUsers.email })
    ).length;

    deletes['redirects'] = (
      await tx
        .delete(schema.redirects)
        .where(inArray(schema.redirects.tenantId, victimIds))
        .returning({ id: schema.redirects.id })
    ).length;

    deletes['page_templates'] = (
      await tx
        .delete(schema.pageTemplates)
        .where(inArray(schema.pageTemplates.tenantId, victimIds))
        .returning({ id: schema.pageTemplates.id })
    ).length;

    // Step 3: finally, drop the tenant rows themselves.
    deletes['tenants'] = (
      await tx
        .delete(schema.tenants)
        .where(inArray(schema.tenants.id, victimIds))
        .returning({ id: schema.tenants.id })
    ).length;

    return { moved: moved.map((m) => m.email), deletes };
  });

  console.log('\nDone. Super_admin users moved to the kept tenant:');
  if (result.moved.length === 0) {
    console.log('  (none)');
  } else {
    for (const e of result.moved) console.log(`  - ${e}`);
  }
  console.log('\nDeletes per table:');
  for (const [table, count] of Object.entries(result.deletes)) {
    console.log(`  ${table.padEnd(34)} ${count}`);
  }
  console.log(`\nFolded ${others.length} tenant(s) into "${keepTenant.slug}".`);
  console.log(
    `Note: S3 objects under the deleted tenant's prefix stay in the bucket (no app dependency on them now — clean up manually from MinIO if you care).`,
  );

  process.exit(0);
}

async function collectPreviewCounts(
  victimIds: readonly string[],
): Promise<Record<string, number>> {
  const tables: TableDelete[] = [
    { name: 'audit_log', table: schema.auditLog },
    { name: 'webhooks', table: schema.webhooks },
    { name: 'search_index_log', table: schema.searchIndexLog },
    { name: 'content', table: schema.content },
    { name: 'content_types', table: schema.contentTypes },
    { name: 'taxonomies', table: schema.taxonomies },
    { name: 'pages', table: schema.pages },
    { name: 'menus', table: schema.menus },
    { name: 'site_settings', table: schema.siteSettings },
    { name: 'email_settings', table: schema.emailSettings },
    { name: 'storage_settings', table: schema.storageSettings },
    { name: 'monitoring_settings', table: schema.monitoringSettings },
    { name: 'system_settings', table: schema.systemSettings },
    { name: 'media', table: schema.media },
    { name: 'media_folders', table: schema.mediaFolders },
    { name: 'api_keys', table: schema.apiKeys },
    { name: 'public_users', table: schema.publicUsers },
    { name: 'redirects', table: schema.redirects },
    { name: 'page_templates', table: schema.pageTemplates },
  ];

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const rows = await db
      .select({ id: t.table.tenantId })
      .from(t.table as never)
      .where(inArray(t.table.tenantId, victimIds));
    counts[t.name] = rows.length;
  }

  // admin_users counts — split by role so the preview is honest about what
  // moves vs what gets deleted.
  const moved = await db
    .select({ email: schema.adminUsers.email })
    .from(schema.adminUsers)
    .where(
      and(
        inArray(schema.adminUsers.tenantId, victimIds),
        eq(schema.adminUsers.role, 'super_admin'),
      ),
    );
  const deletedAdmins = await db
    .select({ email: schema.adminUsers.email })
    .from(schema.adminUsers)
    .where(
      and(
        inArray(schema.adminUsers.tenantId, victimIds),
        ne(schema.adminUsers.role, 'super_admin'),
      ),
    );

  counts['admin_users (super_admin → MOVED)'] = moved.length;
  counts['admin_users (other → DELETED)'] = deletedAdmins.length;
  counts['tenants'] = victimIds.length;
  return counts;
}

function printPreview(counts: Record<string, number>): void {
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(40)} ${v}`);
  }
}

main().catch((err: unknown) => {
  console.error('fold:single-tenant — failed:', err);
  process.exit(1);
});
