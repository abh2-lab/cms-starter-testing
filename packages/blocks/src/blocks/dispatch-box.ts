import type { Block } from '../types.js';

// dispatch-box — a standalone block: the black "From the Editors" call-to-
// action card from the category sidebar. Pure editorial copy (no box/archive
// dependency), so the previously hardcoded strings become editable fields and
// the card can be reordered/removed per archive in the structure editor.

interface DispatchBoxFields {
  title?: string;
  text?: string;
  cta_label?: string;
  cta_url?: string;
}

export const dispatchBox: Block<DispatchBoxFields, Record<string, unknown>> = {
  meta: {
    key: 'dispatch-box',
    label: 'Dispatch Box',
    category: 'archive',
    description: 'Dark call-to-action card with a title, blurb and button.',
    icon: 'megaphone',
    fields: [
      {
        key: 'title',
        label: 'Title',
        type: 'short_text',
        default: 'From the Editors',
      },
      {
        key: 'text',
        label: 'Text',
        type: 'long_text',
        default:
          "Understanding the systems that govern your data, your rights, and your digital life shouldn't require a law degree or a computer science background. That's what this section is for.",
      },
      {
        key: 'cta_label',
        label: 'Button label',
        type: 'short_text',
        default: 'Report With Us',
      },
      {
        key: 'cta_url',
        label: 'Button link',
        type: 'url',
        default: '/about',
      },
    ],
    options: [],
  },
  // Fields-only block — the renderer reads the copy straight from `fields`.
  load() {
    return Promise.resolve(null);
  },
};
