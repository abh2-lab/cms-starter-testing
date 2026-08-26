import type { TemplateMeta } from '../types.js';

// The `single-portfolio` template — the detail page for a Portfolio entry.
// Rendered by the ISOLATED PortfolioView shell (never ArticleView), which reads
// each block's `region` option to place it:
//   hero   — the full-width dark title band at the very top;
//   main   — the left content column (the thumbnail);
//   body   — the left column rich-text body (wrapped in .portfolio-body so its
//            headings/lists/links get article typography);
//   aside  — the right sidebar column (share buttons, then the contact card);
//   outro  — the full-width previous/next row at the bottom.
// The optional sub-heading (custom_fields.subtitle) is drawn by the shell above
// the thumbnail, so it is not a block here.
export const singlePortfolio: TemplateMeta = {
  key: 'single-portfolio',
  role: 'single',
  name: 'Single — portfolio',
  description:
    'The portfolio detail page: dark title band, thumbnail, rich-text body, share buttons, a "Send Us A Message" card, and previous/next navigation.',
  blocks: [
    {
      block_key: 'title-band',
      default_fields: {},
      default_options: { region: 'hero' },
    },
    {
      block_key: 'featured-image',
      default_fields: {},
      default_options: { region: 'main' },
    },
    {
      block_key: 'post-content',
      default_fields: {},
      default_options: { field_name: 'description', region: 'body' },
    },
    {
      block_key: 'social-share',
      default_fields: { label: 'Share:' },
      default_options: { region: 'aside' },
    },
    {
      block_key: 'sidebar-contact-card',
      default_fields: {},
      default_options: {
        content_type_slug: 'portfolio-inquiry',
        region: 'aside',
      },
    },
    {
      block_key: 'prev-next-nav',
      default_fields: {},
      default_options: { region: 'outro' },
    },
  ],
};
