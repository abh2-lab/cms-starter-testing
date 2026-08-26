import { eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { SlugResolver } from './resolve.js';
import type { MenuFixture } from './schemas.js';

// Menu items have no unique constraint (see schema/menus.ts), so we use the
// only safe strategy: when a menu is newly inserted, write all its items in
// one shot. When a menu already exists, leave its items alone — assume the
// editor owns them. This mirrors sample-data.ts behavior at lines 547-552.
//
// Two-pass on items: first pass inserts all items with parent_id null and
// captures their ids by label, second pass UPDATEs parent_id for items
// whose fixture set parent_label.

export async function seedMenus(args: {
  tenantId: string;
  fixtures: MenuFixture[];
  resolver: SlugResolver;
}): Promise<{ menus: number; menuItems: number }> {
  let insertedMenus = 0;
  let insertedItems = 0;

  for (const fixture of args.fixtures) {
    const menuInsert = await db
      .insert(schema.menus)
      .values({
        tenantId: args.tenantId,
        name: fixture.name,
        slug: fixture.slug,
        ...(fixture.description !== undefined
          ? { description: fixture.description }
          : {}),
        isActive: fixture.is_active,
      })
      .onConflictDoNothing({
        target: [schema.menus.tenantId, schema.menus.slug],
      })
      .returning({
        id: schema.menus.id,
        slug: schema.menus.slug,
      });

    if (menuInsert.length === 0) continue; // existing menu — editor-owned items

    insertedMenus += 1;
    const menuId = menuInsert[0]!.id;
    args.resolver.primeMenu(fixture.slug, menuId);

    if (fixture.items.length === 0) continue;

    // Pass 1: flat insert with parent_id null. Collect ids by label.
    // url may legitimately be null when content_type_slug + content_slug
    // resolve to a contentId — the public route derives the URL from the
    // content type's previewPath at render time.
    const itemIdsByLabel = new Map<string, string>();
    for (const item of fixture.items) {
      const contentId =
        item.content_type_slug !== undefined && item.content_slug !== undefined
          ? args.resolver.contentOrNull(item.content_type_slug, item.content_slug)
          : null;

      const itemInsert = await db
        .insert(schema.menuItems)
        .values({
          tenantId: args.tenantId,
          menuId,
          label: item.label,
          url: item.url ?? null,
          ...(contentId !== null ? { contentId } : {}),
          openInNewTab: item.open_in_new_tab,
          ...(item.icon !== undefined ? { icon: item.icon } : {}),
          sortOrder: item.sort_order,
          isActive: item.is_active,
        })
        .returning({ id: schema.menuItems.id });

      const itemId = itemInsert[0]!.id;
      itemIdsByLabel.set(item.label, itemId);
      insertedItems += 1;
    }

    // Pass 2: set parent_id for items with parent_label.
    for (const item of fixture.items) {
      if (item.parent_label === undefined) continue;
      const itemId = itemIdsByLabel.get(item.label);
      const parentId = itemIdsByLabel.get(item.parent_label);
      if (itemId === undefined || parentId === undefined) continue;
      await db
        .update(schema.menuItems)
        .set({ parentId })
        .where(eq(schema.menuItems.id, itemId));
    }
  }

  return { menus: insertedMenus, menuItems: insertedItems };
}
