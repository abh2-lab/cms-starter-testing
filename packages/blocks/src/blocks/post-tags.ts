import type { Block } from '../types.js';

// post-tags — a FIELD block: the hashtag chip row under the article body.
// Projects every non-category taxonomy term off the current box (categories
// belong to the breadcrumb, not the tag row — same split the hand-built
// ArticleView made).

export const postTags: Block = {
  meta: {
    key: 'post-tags',
    label: 'Post Tags',
    category: 'article',
    description:
      "Hashtag chips for the current post's tags. Must sit inside a box.",
    icon: 'folder',
    kind: 'field',
    fields: [],
    options: [],
  },
  load(ctx) {
    const taxonomy = ctx.box?.content.taxonomy ?? [];
    return Promise.resolve({
      tags: taxonomy.filter((t) => t.taxonomySlug !== 'categories'),
    });
  },
};
