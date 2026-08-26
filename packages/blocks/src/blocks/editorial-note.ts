import type { Block } from '../types.js';

// editorial-note — a FIELD block: the cream "Why read this" card that renders
// the post's excerpt above the body. Renders nothing when the post has no
// excerpt (same gate the hand-built ArticleView applied).

interface EditorialNoteFields {
  label?: string;
}

export const editorialNote: Block<
  EditorialNoteFields,
  Record<string, unknown>
> = {
  meta: {
    key: 'editorial-note',
    label: 'Editorial Note',
    category: 'article',
    description:
      "Cream callout card rendering the post's excerpt with an editorial label. Must sit inside a box.",
    icon: 'page',
    kind: 'field',
    fields: [
      {
        key: 'label',
        label: 'Label',
        type: 'short_text',
        default: 'Editorial Note: Why read this',
      },
    ],
    options: [],
  },
  load(ctx) {
    return Promise.resolve({ text: ctx.box?.content.excerpt ?? null });
  },
};
