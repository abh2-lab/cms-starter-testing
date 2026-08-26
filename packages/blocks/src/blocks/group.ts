import type { Block } from '../types.js';

// group — a CONTAINER block. Carries layout + spacing styling and holds child
// blocks; the box (if any) passes through unchanged to its descendants. This is
// where STYLE lives (architecture rule: field blocks are style-unaware, the
// container styles them). The style fields below map to a small fixed set of
// CSS classes in the theme layer (BlockGroup.vue) that reference the existing
// theme.css tokens — NOT a free-form token system (deferred to v2).

interface GroupFields {
  width?: string; // 'full' | 'wide' | 'narrow'
  direction?: string; // 'column' | 'row' (e.g. an inline date + author meta row)
  background?: string; // 'none' | 'surface' | 'muted'
  padding?: string; // 'none' | 'sm' | 'md' | 'lg'
  gap?: string; // 'none' | 'sm' | 'md' | 'lg'
  tag?: string; // semantic wrapper: 'div' | 'section' | 'article'
}

export const group: Block<GroupFields, Record<string, unknown>> = {
  meta: {
    key: 'group',
    label: 'Group',
    category: 'layout',
    description:
      'A styling container that holds child blocks. Carries the layout/spacing; the children adopt it.',
    icon: 'square',
    kind: 'container',
    fields: [
      {
        key: 'width',
        label: 'Width',
        type: 'select',
        options: ['full', 'wide', 'narrow'],
        default: 'wide',
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        options: ['column', 'row'],
        default: 'column',
      },
      {
        key: 'background',
        label: 'Background',
        type: 'select',
        options: ['none', 'surface', 'muted'],
        default: 'none',
      },
      {
        key: 'padding',
        label: 'Padding',
        type: 'select',
        options: ['none', 'sm', 'md', 'lg'],
        default: 'none',
      },
      {
        key: 'gap',
        label: 'Gap between children',
        type: 'select',
        options: ['none', 'sm', 'md', 'lg'],
        default: 'md',
      },
      {
        key: 'tag',
        label: 'HTML tag',
        type: 'select',
        options: ['div', 'section', 'article'],
        default: 'div',
      },
    ],
    options: [],
  },
  // Pure container — no data. The composer still recurses its children.
  load() {
    return Promise.resolve(null);
  },
};
