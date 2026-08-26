import type { TemplateMeta } from '../types.js';

// The `archive` template — a category/tag listing rendered as a declarative
// block-list: an archive-title header (reads the browsed term from ctx.archive)
// followed by a query-loop that iterates the term's posts and renders a card
// (group container + field blocks) per post.
//
// It carries NO category value: the query-loop inherits the browsed term from
// ctx.archive (see query-loop.resolveBoxes), so this ONE template serves every
// category and tag — the "by-category" condition lives in selection/context,
// never in the template (architecture rule #7).
//
// v1 status: authored + unit-tested. The Decode CategoryArchiveView/
// TagArchiveView keep their hand-built chrome for now (the user chose
// "keep chrome"); wiring archives to render from this template is a later pass,
// the same deferral as the article chrome. The composer + ctx.archive plumbing
// are ready for it.
export const archiveDefault: TemplateMeta = {
  key: 'archive-default',
  role: 'archive',
  name: 'Archive — default',
  description:
    'Archive header + a query-loop grid of post cards for the browsed term.',
  blocks: [
    { block_key: 'archive-title', default_fields: {}, default_options: {} },
    {
      block_key: 'query-loop',
      default_fields: {},
      // No category — inherited from ctx.archive. content_type defaults to
      // article; count caps the grid.
      default_options: { content_type: 'article', count: 12 },
      children: [
        {
          block_key: 'group',
          default_fields: {
            direction: 'column',
            gap: 'sm',
            background: 'surface',
            padding: 'sm',
          },
          default_options: {},
          children: [
            { block_key: 'featured-image', default_fields: {}, default_options: {} },
            { block_key: 'post-title', default_fields: { level: 3 }, default_options: {} },
            {
              block_key: 'published-at',
              default_fields: { format: 'short' },
              default_options: {},
            },
          ],
        },
      ],
    },
  ],
};
