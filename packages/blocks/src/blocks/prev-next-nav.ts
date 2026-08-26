import type { Block } from '../types.js';

// Prev / Next Nav — links to the neighbouring entries of the current post's
// type. A FIELD block: it reads the current slug + type from the box, then lists
// the type's entries (newest first, the same order the archive uses) via
// ctx.fetchArchive and picks the rows on either side of the current one. Pure —
// it only uses the context, no direct DB access and no new context method.
//
// The archive is capped at COUNT rows, so on a very large type the oldest posts
// fall outside the window and get no "previous" link. Fine for the portfolio
// type (a handful of entries per category); revisit if it grows past COUNT.

interface NavLink {
  title: string;
  slug: string;
  // The neighbour's portfolio-categories term slug — the first segment of its
  // detail-page URL (/<category>/<slug>). null falls back to /portfolio/.
  category: string | null;
}
interface PrevNextData extends Record<string, unknown> {
  prev: NavLink | null;
  next: NavLink | null;
}

// Matches work-grid's HARD_MAX_COUNT so one fetch covers the whole type today.
const COUNT = 24;

export const prevNextNav: Block<
  Record<string, unknown>,
  Record<string, unknown>
> = {
  meta: {
    key: 'prev-next-nav',
    label: 'Prev / Next Nav',
    category: 'fields',
    description:
      "Links to the previous and next entries of the current post's type.",
    icon: 'arrows-left-right',
    kind: 'field',
    fields: [],
    options: [],
  },
  async load(ctx): Promise<PrevNextData> {
    const content = ctx.box?.content;
    const empty: PrevNextData = { prev: null, next: null };
    if (!content) return empty;

    // Scope neighbours to the SAME category so prev/next stays within Brands /
    // Platforms / Publishing, and every link builds as /<category>/<slug>.
    const CATEGORY_TAXONOMY = 'portfolio-categories';
    const category = content.taxonomy.find(
      (t) => t.taxonomySlug === CATEGORY_TAXONOMY,
    )?.termSlug;

    const items = await ctx.fetchArchive({
      typeSlug: content.type,
      count: COUNT,
      ...(category ? { category, taxonomy: CATEGORY_TAXONOMY } : {}),
    });
    const idx = items.findIndex((i) => i.slug === content.slug);
    if (idx === -1) return empty;

    // items arrive newest-first: the newer neighbour sits before the current
    // row, the older one after it. Every neighbour is in `category` (we scoped
    // the fetch), so all links share that prefix.
    const newer = idx > 0 ? items[idx - 1] : undefined;
    const older = idx + 1 < items.length ? items[idx + 1] : undefined;
    const toLink = (x: (typeof items)[number] | undefined): NavLink | null =>
      x ? { title: x.title, slug: x.slug, category: category ?? null } : null;

    // "Previous" reads as the older entry, "Next" as the newer one.
    return { prev: toLink(older), next: toLink(newer) };
  },
};
