import type { TemplateMeta } from '../types.js';

// The `archive-category` template — the Decode category landing page as a
// declarative block-list. Mirrors CategoryArchiveView's hand-built layout
// (decode-allfiles-v3/category-decode-explains.html): a sidebar stack
// (manifesto, editor-notes slider panel, dispatch box) and a post-card grid
// driven by a query-loop.
//
// Regions: top-level blocks carry `region` in default_options — the view
// shell places the 'sidebar' bucket into its sticky <aside> and the 'main'
// bucket into the article column. Unknown/missing region falls back to
// 'main' (see splitBlocksByRegion in the theme), so a malformed override can
// never lose content.
//
// The query-loop carries NO category — it inherits the browsed term (and its
// taxonomy scope) from ctx.archive, so this ONE template serves every
// category (architecture rule #7: by-category conditions live in selection/
// context, never in templates). grid:'none' keeps the wrapper transparent —
// the view shell owns the 2-column grid so raw load-more appends land in the
// same grid as the composed page-1 cards.
export const archiveCategory: TemplateMeta = {
  key: 'archive-category',
  role: 'archive',
  name: 'Archive — category',
  description:
    'Category landing: sidebar manifesto + editor notes + dispatch box, with a post-card grid.',
  blocks: [
    {
      block_key: 'archive-manifesto',
      default_fields: { label: 'Archive' },
      default_options: { region: 'sidebar' },
    },
    {
      block_key: 'editor-notes-column',
      default_fields: {},
      default_options: { region: 'sidebar' },
    },
    {
      block_key: 'dispatch-box',
      default_fields: {
        title: 'From the Editors',
        text: "Understanding the systems that govern your data, your rights, and your digital life shouldn't require a law degree or a computer science background. That's what this section is for.",
        cta_label: 'Report With Us',
        cta_url: '/about',
      },
      default_options: { region: 'sidebar' },
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
