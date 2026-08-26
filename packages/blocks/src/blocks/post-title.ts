import type { Block } from '../types.js';

// post-title — a FIELD block. Style-unaware: it reads the current post's title
// from the box (set by an enclosing box block or by the single-article route)
// and projects it into `data`. The container/template owns all styling. Renders
// nothing outside a box.

interface PostTitleFields {
  level?: number; // heading level h1–h6; the renderer reads this. default 1
}

export const postTitle: Block<PostTitleFields, Record<string, unknown>> = {
  meta: {
    key: 'post-title',
    label: 'Post Title',
    category: 'fields',
    description:
      'Renders the current post title. Must sit inside a box (single post or query-loop).',
    icon: 'type',
    kind: 'field',
    fields: [
      {
        key: 'level',
        label: 'Heading level',
        type: 'number',
        default: 1,
        min: 1,
        max: 6,
        helpText: 'h1–h6. Use h1 once per page (the single article title).',
      },
    ],
    options: [],
  },
  load(ctx) {
    return Promise.resolve({ title: ctx.box?.content.title ?? null });
  },
};
