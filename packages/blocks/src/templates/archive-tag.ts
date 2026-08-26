import type { TemplateMeta } from '../types.js';

// The `archive-tag` template — the Decode tag landing page as a declarative
// block-list. Mirrors TagArchiveView's hand-built layout (decode-allfiles-v3/
// tag-digital-rights.html): a dark hero (kicker, #HashTitle, description,
// story count) above a post-card grid driven by a query-loop.
//
// Regions: the 'hero' bucket renders full-width above the articles section;
// 'main' renders inside it (see splitBlocksByRegion in the theme). The
// query-loop inherits the browsed tag + taxonomy scope from ctx.archive and
// stays grid:'none' — the view shell owns the auto-fill grid so raw
// load-more appends land in the same grid as the composed page-1 cards.
// Related-tags chips stay view chrome (derived client-side from loaded
// items; nil editor value).
export const archiveTag: TemplateMeta = {
  key: 'archive-tag',
  role: 'archive',
  name: 'Archive — tag',
  description:
    'Tag landing: dark hash-tag hero above a post-card grid of tagged stories.',
  blocks: [
    {
      block_key: 'archive-hero',
      default_fields: { kicker: 'Tag' },
      default_options: { region: 'hero' },
    },
    {
      block_key: 'query-loop',
      default_fields: {},
      default_options: {
        content_type: 'article',
        count: 12,
        grid: 'none',
        region: 'main',
      },
      children: [
        { block_key: 'post-card', default_fields: {}, default_options: {} },
      ],
    },
  ],
};
