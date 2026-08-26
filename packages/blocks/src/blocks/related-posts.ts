import type { Block } from '../types.js';

// related-posts — a FIELD block: the "Read next" card under the article.
// Pulls the latest published posts from the current box's primary category
// (or site-wide latest when the post has no category — the hand-built view
// behaved the same), excludes the post itself, and projects compact items.
// Server-side on purpose: the old view fetched these client/SSR-side per
// page; composing them ships related links inside the cached payload.

interface RelatedPostsFields {
  heading?: string;
}

interface RelatedPostsOptions {
  count?: number;
}

const MAX_COUNT = 6;

export const relatedPosts: Block<RelatedPostsFields, RelatedPostsOptions> = {
  meta: {
    key: 'related-posts',
    label: 'Related Posts',
    category: 'article',
    description:
      "Compact 'Read next' links from the current post's primary category. Must sit inside a box.",
    icon: 'newspaper',
    kind: 'field',
    fields: [
      {
        key: 'heading',
        label: 'Heading',
        type: 'short_text',
        default: 'Read next',
      },
    ],
    options: [
      {
        key: 'count',
        label: 'Number of posts',
        type: 'number',
        default: 3,
        min: 1,
        max: MAX_COUNT,
      },
    ],
  },
  async load(ctx, { options }) {
    const box = ctx.box;
    if (!box) return null;
    const requested = Number.isFinite(options.count)
      ? Number(options.count)
      : 3;
    const count = Math.max(1, Math.min(MAX_COUNT, requested));
    const category = box.content.taxonomy.find(
      (t) => t.taxonomySlug === 'categories',
    )?.termSlug;
    // Over-fetch so excluding the current post still fills the row (3 → 6,
    // matching the old view's fixed pageSize of 6 for its 3 slots).
    const items = await ctx.fetchArchive({
      typeSlug: box.content.type,
      ...(category ? { category } : {}),
      count: count + 3,
    });
    const related = items
      .filter((s) => s.slug !== box.content.slug)
      .slice(0, count)
      .map((s) => ({
        id: s.id,
        title: s.title,
        slug: s.slug,
        primaryCategorySlug:
          s.taxonomy.find((t) => t.taxonomySlug === 'categories')?.termSlug ??
          null,
      }));
    return { items: related };
  },
};
