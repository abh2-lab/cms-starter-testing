import type { TemplateMeta } from '../types.js';

// The `404` template (theme engine v2 Phase 4) — the body of the error page,
// rendered by the theme's error.vue inside the normal site chrome. Default tree
// = the not-found block; an install can add blocks below it (latest stories, a
// search prompt) so a dead end still routes readers somewhere useful.
export const notFoundTemplate: TemplateMeta = {
  key: 'template-404',
  role: '404',
  name: 'Not Found (404)',
  description: 'The 404 error page body shown for any unmatched URL.',
  blocks: [
    { block_key: 'not-found', default_fields: {}, default_options: {} },
  ],
};
