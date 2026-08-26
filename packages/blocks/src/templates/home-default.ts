import type { TemplateMeta } from '../types.js';

// home-default — the default neutral homepage template. Three blocks in a
// simple visual order: hero up top, the latest-news grid below, an
// impact-stats strip at the bottom. Defaults are intentionally generic so
// the template works out of the box against any content_type the publisher
// configures.

export const homeDefault: TemplateMeta = {
  key: 'home-default',
  role: 'home',
  name: 'Home — default',
  description:
    'Default homepage layout: hero, latest-news grid, impact-stats strip.',
  blocks: [
    {
      block_key: 'hero',
      default_fields: { badge: 'Featured' },
      default_options: { content_type: 'article', slug: '' },
    },
    {
      block_key: 'latest-news',
      default_fields: { eyebrow: 'Latest', title: 'Latest articles' },
      default_options: { content_type: 'article', count: 6 },
    },
    {
      block_key: 'impact-stats',
      default_fields: {
        eyebrow: 'By the numbers',
        title: 'A quick snapshot',
        stats: [
          { label: 'Articles published', value: '0' },
          { label: 'Active categories', value: '0' },
          { label: 'Contributing authors', value: '0' },
          { label: 'Reader views', value: '0' },
        ],
      },
      default_options: {},
    },
  ],
};
