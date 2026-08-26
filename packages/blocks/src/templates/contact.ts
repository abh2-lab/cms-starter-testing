import type { TemplateMeta } from '../types.js';

// The `contact` template (theme engine v2 Phase 4) — the /contact page. The
// contact-form block carries the heading, intro and the submission form; an
// install can add blocks around it (office address, a map, an FAQ) from the
// structure editor.
export const contactTemplate: TemplateMeta = {
  key: 'template-contact',
  role: 'contact',
  name: 'Contact',
  description: 'The contact page: heading, intro and the submission form.',
  blocks: [
    { block_key: 'contact-form', default_fields: {}, default_options: {} },
  ],
};
