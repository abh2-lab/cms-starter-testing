/**
 * Seed the default navigation menus (main-nav + footer-nav) for a tenant.
 *
 * Usage:
 *   pnpm --filter @cms/api seed:menus                 # tenant = PUBLIC_TENANT_SLUG
 *   pnpm --filter @cms/api seed:menus -- --tenant=decode
 *
 * Idempotent: a menu is created only when its slug does not already exist for
 * the tenant. If it exists, the script leaves it (and its items) untouched —
 * the editor owns it from then on. Targets an EXISTING tenant; it does not
 * create one. After seeding, the header/footer render these links from the DB
 * and editors can change them in admin → Menus.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { env } from '@cms/config';
import { invalidatePattern, closeRedis } from '../src/lib/cache.js';

interface SeedItem {
  label: string;
  url: string | null;
  parent?: string;
}
interface SeedMenu {
  slug: string;
  name: string;
  description: string;
  items: SeedItem[];
}

// Mirrors the hardcoded fallback in SiteHeader.vue / SiteFooter.vue so the live
// site is unchanged the moment it switches to DB-driven menus. URLs follow the
// theme's url rules (categoryUrl → /<slug>, static pages at root).
const MENUS: SeedMenu[] = [
  {
    slug: 'main-nav',
    name: 'Main Navigation',
    description:
      'Primary header navigation. Top-level items with children render as dropdowns.',
    items: [
      { label: 'Home', url: '/' },
      { label: 'Events', url: '/events' },
      { label: 'Categories', url: null },
      { label: 'Young Minds', url: '/young-minds', parent: 'Categories' },
      { label: 'Digital State', url: '/digital-state', parent: 'Categories' },
      { label: 'Labour', url: '/labour', parent: 'Categories' },
      { label: 'Life', url: '/life', parent: 'Categories' },
      { label: 'Decode Explains', url: '/decode-explains', parent: 'Categories' },
      { label: 'Voices', url: '/voices', parent: 'Categories' },
      { label: 'About', url: null },
      { label: 'About Decode', url: '/about', parent: 'About' },
      { label: 'Mission', url: '/mission', parent: 'About' },
      { label: 'How to Pitch', url: '/how-to-pitch', parent: 'About' },
    ],
  },
  {
    slug: 'footer-nav',
    name: 'Footer',
    description:
      'Footer link columns. Each top-level item is a column heading; its children are the links.',
    items: [
      { label: 'Explore', url: null },
      { label: 'Young Minds', url: '/young-minds', parent: 'Explore' },
      { label: 'Digital State', url: '/digital-state', parent: 'Explore' },
      { label: 'Labour', url: '/labour', parent: 'Explore' },
      { label: 'Life', url: '/life', parent: 'Explore' },
      { label: 'Decode', url: null },
      { label: 'About Us', url: '/about', parent: 'Decode' },
      { label: 'Our Team', url: '/authors', parent: 'Decode' },
      { label: 'Mission', url: '/mission', parent: 'Decode' },
      { label: 'How to Pitch', url: '/how-to-pitch', parent: 'Decode' },
      { label: 'Events', url: '/events', parent: 'Decode' },
      { label: 'Support', url: null },
      { label: 'Become a Member', url: '/about', parent: 'Support' },
      { label: 'Gift a Membership', url: '/about', parent: 'Support' },
      { label: 'Share a Tip', url: '/tipline', parent: 'Support' },
    ],
  },
];

function parseTenantSlug(argv: readonly string[]): string {
  for (const arg of argv) {
    if (arg.startsWith('--tenant=')) return arg.slice('--tenant='.length);
  }
  return env.PUBLIC_TENANT_SLUG;
}

async function resolveTenantId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug))
    .limit(1);
  if (!row) {
    throw new Error(
      `seed:menus — no tenant with slug "${slug}". Create the tenant first.`,
    );
  }
  return row.id;
}

async function seedMenu(
  tenantId: string,
  menu: SeedMenu,
): Promise<{ created: boolean; items: number }> {
  const inserted = await db
    .insert(schema.menus)
    .values({
      tenantId,
      name: menu.name,
      slug: menu.slug,
      description: menu.description,
      isActive: true,
    })
    .onConflictDoNothing({
      target: [schema.menus.tenantId, schema.menus.slug],
    })
    .returning({ id: schema.menus.id });

  if (inserted.length === 0) return { created: false, items: 0 };

  const menuId = inserted[0]!.id;

  // Sort order is assigned per sibling group (top-level vs each parent) by the
  // order items appear in the array above.
  const counters = new Map<string, number>();
  const nextSort = (parent: string | undefined): number => {
    const key = parent ?? '';
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    return n;
  };

  // Pass 1: insert every item flat (parent_id null), capturing ids by label.
  const idByLabel = new Map<string, string>();
  for (const item of menu.items) {
    const [row] = await db
      .insert(schema.menuItems)
      .values({
        tenantId,
        menuId,
        label: item.label,
        url: item.url,
        sortOrder: nextSort(item.parent),
        isActive: true,
      })
      .returning({ id: schema.menuItems.id });
    idByLabel.set(item.label, row!.id);
  }

  // Pass 2: link each child to its parent (labels are unique within a menu).
  for (const item of menu.items) {
    if (item.parent === undefined) continue;
    const childId = idByLabel.get(item.label);
    const parentId = idByLabel.get(item.parent);
    if (!childId || !parentId) continue;
    await db
      .update(schema.menuItems)
      .set({ parentId })
      .where(eq(schema.menuItems.id, childId));
  }

  return { created: true, items: menu.items.length };
}

async function main(): Promise<void> {
  const slug = parseTenantSlug(process.argv.slice(2));
  const tenantId = await resolveTenantId(slug);
  console.log(`seed:menus — tenant "${slug}" (${tenantId})`);

  for (const menu of MENUS) {
    const res = await seedMenu(tenantId, menu);
    if (res.created) {
      console.log(`  + ${menu.slug}: created with ${res.items} items`);
    } else {
      console.log(`  = ${menu.slug}: already exists — left untouched`);
    }
  }

  // The inserts above bypass the admin API (which would normally bust the
  // cache), so clear the public menu cache here. Otherwise a stale 404/empty
  // entry could be served for up to the 5-minute TTL after a fresh seed.
  await invalidatePattern('cache:menu:*');
  await closeRedis();

  console.log('seed:menus — done (menu cache cleared)');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('seed:menus — failed:', err);
  process.exit(1);
});
