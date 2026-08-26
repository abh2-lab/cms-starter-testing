import type { TemplateMeta } from '../types.js';

// The `search` template (theme engine v2 Phase 4) — the /search page as a
// declarative block-list, the same machinery archives render through. Default
// tree = the search form atop the results list; an install can add blocks
// around them (e.g. a promo, popular tags) from the structure editor.
export const searchTemplate: TemplateMeta = {
  key: 'template-search',
  role: 'search',
  name: 'Search',
  description: 'The search page: a query form above the matching results.',
  blocks: [
    { block_key: 'search-form', default_fields: {}, default_options: {} },
    { block_key: 'search-results', default_fields: {}, default_options: {} },
  ],
};
