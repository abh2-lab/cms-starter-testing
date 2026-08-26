import type { Block } from '../types.js';

// featured-image — a FIELD block. Reads the current post's hero/featured image
// (already resolved to an absolute S3 URL by the block context / content route)
// and the title for alt text. Styling (aspect-ratio, rounding) lives in the
// container/template.

export const featuredImage: Block = {
  meta: {
    key: 'featured-image',
    label: 'Featured Image',
    category: 'fields',
    description:
      'Renders the current post hero/featured image. Must sit inside a box.',
    icon: 'image',
    kind: 'field',
    fields: [],
    options: [],
  },
  load(ctx) {
    const box = ctx.box;
    return Promise.resolve({
      url: box?.content.heroImageUrl ?? null,
      alt: box?.content.title ?? null,
    });
  },
};
