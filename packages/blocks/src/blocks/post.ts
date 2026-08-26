import type { Block, PostBox } from '../types.js';

// post — a BOX block that selects ONE post by slug and sets it as the current
// box for its child field blocks. This is the "self-sufficient box" escape
// hatch: drop it on any page to render a specific story with field blocks
// (featured-image + post-title + post-content, styled by an enclosing group)
// without the page itself being an article. The single-article ROUTE builds its
// box directly from the resolved row, so it does NOT need this block.
//
// Resolves to a 'detail' box (full customFields), so a child post-content
// renders the body with no extra hydration.

interface PostOptions {
  content_type?: string;
  slug?: string;
}

export const post: Block<Record<string, unknown>, PostOptions> = {
  meta: {
    key: 'post',
    label: 'Post (single)',
    category: 'box',
    description:
      'Selects one post by slug and renders its child blocks with that post as the current box.',
    icon: 'file',
    kind: 'box',
    fields: [],
    options: [
      {
        key: 'content_type',
        label: 'Content type',
        type: 'content_type_slug',
        required: true,
        default: 'article',
      },
      {
        key: 'slug',
        label: 'Post slug',
        type: 'content_slug',
        required: true,
      },
    ],
  },
  load() {
    return Promise.resolve(null);
  },
  async resolveBoxes(ctx, { options }) {
    const typeSlug = options.content_type ?? 'article';
    const slug = typeof options.slug === 'string' ? options.slug : '';
    if (!slug) return [];
    const detail = await ctx.fetchContent(typeSlug, slug);
    if (!detail) return [];
    return [
      { kind: 'detail', content: detail, detail, index: 0, total: 1 } satisfies PostBox,
    ];
  },
};
