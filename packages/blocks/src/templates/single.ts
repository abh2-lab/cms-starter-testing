import type { TemplateMeta } from '../types.js';

// The `single` template — the article rendered as a declarative block-list
// (the SAME machinery pages render through). v1 composed only the body
// column; v1.5 grows the tree to the full content stack so the structure
// editor never hits "this part can't be edited".
//
// Regions (see splitBlocksByRegion in the theme): ArticleView still owns the
// page SHELL — the 3-column grid, sticky share rail, breadcrumb + font-size
// row, the `.article-content` body wrapper (whose :deep() typography + reader
// font-size classes must keep applying unchanged), the mobile share card and
// the NYT CSS variant. The template's top-level blocks slot into that shell:
//   hero  — full-width above the grid (dark hero stage);
//   lede  — in the content column, above the body wrapper;
//   body  — INSIDE the `.article-content` wrapper (the TipTap body);
//   outro — in the content column, below the body wrapper.
// Unknown/missing regions render with the lede (content stays visible).
//
// The decode/nyt visual difference stays a CSS variant on ArticleView
// (resolvePostTemplateVariant); both post-template keys share this tree.
export const singleArticle: TemplateMeta = {
  key: 'single-article',
  role: 'single',
  name: 'Single — article',
  description:
    'The article page content: hero, editorial note, TOC, body, tags, credits, related stories and author bios.',
  blocks: [
    {
      block_key: 'post-hero',
      default_fields: {},
      default_options: { region: 'hero' },
    },
    {
      block_key: 'editorial-note',
      default_fields: { label: 'Editorial Note: Why read this' },
      default_options: { region: 'lede' },
    },
    {
      block_key: 'article-toc',
      default_fields: { label: 'In this story', title: 'Quick navigation' },
      default_options: { region: 'lede' },
    },
    {
      block_key: 'post-content',
      default_fields: {},
      default_options: { field_name: 'body', region: 'body' },
    },
    {
      block_key: 'post-tags',
      default_fields: {},
      default_options: { region: 'outro' },
    },
    {
      block_key: 'editor-credit',
      default_fields: { prefix: 'Edited by' },
      default_options: { region: 'outro' },
    },
    {
      block_key: 'related-posts',
      default_fields: { heading: 'Read next' },
      default_options: { count: 3, region: 'outro' },
    },
    {
      block_key: 'author-bios',
      default_fields: {},
      default_options: { region: 'outro' },
    },
  ],
};
