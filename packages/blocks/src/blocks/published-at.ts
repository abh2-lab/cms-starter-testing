import type { Block } from '../types.js';

// published-at — a FIELD block. Projects the current post's publish date (ISO)
// for the renderer to format. Style-unaware.

interface PublishedAtFields {
  format?: string; // 'long' | 'short' — the renderer interprets. default 'long'
}

export const publishedAt: Block<PublishedAtFields, Record<string, unknown>> = {
  meta: {
    key: 'published-at',
    label: 'Published Date',
    category: 'fields',
    description: 'Renders the current post publish date. Must sit inside a box.',
    icon: 'calendar',
    kind: 'field',
    fields: [
      {
        key: 'format',
        label: 'Date format',
        type: 'select',
        options: ['long', 'short'],
        default: 'long',
      },
    ],
    options: [],
  },
  load(ctx) {
    return Promise.resolve({ iso: ctx.box?.content.publishedAt ?? null });
  },
};
