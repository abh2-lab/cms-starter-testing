import type { TemplateMeta } from '../types.js';

// The `authors` template (theme engine v2 Phase 4) — the /authors index. The
// author-grid block carries the hero + filter + card grid; an install can add
// blocks around it (a manifesto, a join-us CTA) from the structure editor.
export const authorsTemplate: TemplateMeta = {
  key: 'template-authors',
  role: 'authors',
  name: 'Authors',
  description: 'The authors index: hero, filter bar and the author card grid.',
  blocks: [
    { block_key: 'author-grid', default_fields: {}, default_options: {} },
  ],
};
