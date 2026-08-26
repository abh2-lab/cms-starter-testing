import type { TemplateMeta } from '../types.js';

// The `header` PART — a named, reusable block-list with the reserved
// 'header' role. Parts are TemplateMeta entries like templates, but they are
// mounted by the LAYOUT (via GET /api/public/parts/:key + useCmsPart) rather
// than selected per-route by resolveTemplate. Two blocks: the site-nav
// organism (see its definition for why the header stays coarse) plus the
// search-overlay modal — a global, fixed-position dialog (Teleport-to-body)
// opened by the nav's search button via shared useSearchOverlay state.
export const headerPart: TemplateMeta = {
  key: 'header',
  role: 'header',
  name: 'Header',
  description:
    'The site-wide header: logo, menu navigation, and action buttons.',
  // Bumped to 3 for the PING rebrand: the search button is hidden by default
  // (the design has no header search) and the action button becomes the
  // "Join Our Network" CTA. Installs with a saved header override see an
  // "update available".
  // 4: Subscribe hidden too, on request — "Join Our Network" is the header's
  // single action now. Hidden rather than deleted, same as search: the label
  // field and the markup stay, so an admin can switch it back on from the
  // block's options without a code change.
  version: 4,
  blocks: [
    {
      block_key: 'site-nav',
      default_fields: {
        subscribe_label: 'Subscribe',
        signin_label: 'Join Our Network',
      },
      default_options: {
        menu_slug: 'main-nav',
        show_subscribe: false,
        show_search: false,
        show_signin: true,
      },
    },
    {
      // The "What are you looking for?" search modal. Standalone, position:fixed
      // + Teleport-to-body, so its place in the block list doesn't matter — it
      // covers the viewport when the site-nav search button opens it (shared
      // useSearchOverlay state) and submits to /search.
      block_key: 'search-overlay',
      default_fields: {
        heading: 'What are you looking for?',
        placeholder: 'Search stories, topics, authors…',
        button_label: 'Search',
        categories_label: 'Popular Categories',
        spotlight_label: 'Spotlight',
        categories: [
          { label: '🧠 Young Minds', value: 'young-minds' },
          { label: '🏛️ Digital State', value: 'digital-state' },
          { label: '⚙️ Labour', value: 'labour' },
          { label: '🌿 Life', value: 'life' },
          { label: '💡 Decode Explains', value: 'decode-explains' },
          { label: '🎙️ Voices', value: 'voices' },
        ],
      },
      // Spotlight binding cleared for PING — no Decode demo content is seeded,
      // and an empty slug keeps verify:theme:content green (only non-empty
      // content bindings are checked). Re-point it at a real post to re-enable.
      default_options: {
        spotlight_content_type: 'article',
        spotlight_slug: '',
      },
    },
  ],
};
