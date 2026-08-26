import type { Block } from '../types.js';

// editor-notes-column — a standalone block: the cream sidebar panel wrapping
// the "From the Editor" promo slider in its column layout (image stacked on
// top). The slider itself is self-contained (design-locked copy, own state) —
// this block exists so the panel can be reordered/removed per archive in the
// structure editor. Distinct from the home page's `editor-notes` block, which
// wraps the same slider in the row-layout discovery card.

export const editorNotesColumn: Block = {
  meta: {
    key: 'editor-notes-column',
    label: 'Editor Notes (column)',
    category: 'archive',
    description:
      'Sidebar panel with the "From the Editor" slider in column layout.',
    icon: 'megaphone',
    fields: [],
    options: [],
  },
  // Presentational wrapper — the slider fetches nothing and the panel has no
  // editable copy in v1.5.
  load() {
    return Promise.resolve(null);
  },
};
