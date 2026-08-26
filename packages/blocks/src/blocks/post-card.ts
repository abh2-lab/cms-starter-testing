import type { Block } from '../types.js';

// post-card — a FIELD block that projects the current post box into the card
// shape the theme's ScardCard component renders (the shared cream card used by
// the home "More from Decode" grid and the archive grids). Deliberately coarse:
// archive re-blocking must keep pixel parity, so the card stays ONE block
// wrapping the existing component instead of a group-of-fields rebuild.
// Renders nothing outside a box.

export const postCard: Block = {
  meta: {
    key: 'post-card',
    label: 'Post Card',
    category: 'fields',
    description:
      'Renders the current post as a story card (image, category pill, title, excerpt, byline). Must sit inside a box (single post or query-loop).',
    icon: 'newspaper',
    kind: 'field',
    fields: [],
    options: [],
  },
  load(ctx) {
    const content = ctx.box?.content;
    if (!content) return Promise.resolve(null);
    // First 'categories' term — mirrors primaryCategorySlug on the public
    // archive endpoint, so the renderer builds the same canonical
    // /<category>/<article> link the raw list path builds.
    const primaryCategorySlug =
      content.taxonomy.find((t) => t.taxonomySlug === 'categories')
        ?.termSlug ?? null;
    return Promise.resolve({
      id: content.id,
      title: content.title,
      slug: content.slug,
      publishedAt: content.publishedAt,
      authors: content.authors,
      heroImageUrl: content.heroImageUrl,
      excerpt: content.excerpt,
      featured: content.featured,
      taxonomy: content.taxonomy,
      primaryCategorySlug,
    });
  },
};
