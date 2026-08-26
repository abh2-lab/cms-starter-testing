import type { Block } from '../types.js';

// post-author — a FIELD block. Projects the current post's author byline (the
// same { displayName, slug } shape the rest of the theme renders, each linking
// to /author/<slug>). Style-unaware.

interface PostAuthorFields {
  prefix?: string; // e.g. "By" — the renderer prepends it. default "By"
}

export const postAuthor: Block<PostAuthorFields, Record<string, unknown>> = {
  meta: {
    key: 'post-author',
    label: 'Post Author',
    category: 'fields',
    description:
      'Renders the current post author byline. Must sit inside a box.',
    icon: 'user',
    kind: 'field',
    fields: [
      { key: 'prefix', label: 'Byline prefix', type: 'short_text', default: 'By' },
    ],
    options: [],
  },
  load(ctx) {
    return Promise.resolve({ authors: ctx.box?.content.authors ?? null });
  },
};
