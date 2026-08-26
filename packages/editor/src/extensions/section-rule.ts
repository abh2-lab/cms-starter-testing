import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sectionRule: {
      /** Insert a section-rule divider with the given label + optional anchor. */
      insertSectionRule: (attrs: {
        label: string;
        anchorId?: string | null;
      }) => ReturnType;
    };
  }
}

/**
 * A section divider for long-form articles. Renders as a small red kicker
 * label followed by a horizontal rule — matches the Decode mock's
 * `.article-section-rule` pattern. Atom node (no content); the label travels
 * as an attribute. Optional `anchorId` becomes the element's `id` so editors
 * can link to a specific section from a TOC.
 *
 * Styling lives in apps/web/app/pages/article/[slug].vue. The renderer emits:
 *   <div class="article-section-rule" id="...">
 *     <span class="article-section-tag">{label}</span>
 *     <span class="article-section-line"></span>
 *   </div>
 */
export const SectionRule = Node.create({
  name: 'sectionRule',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el: HTMLElement) =>
          el.querySelector('.article-section-tag')?.textContent ?? '',
        renderHTML: () => ({}),
      },
      anchorId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('id') ?? null,
        renderHTML: (attrs: { anchorId?: string | null }) =>
          attrs.anchorId ? { id: attrs.anchorId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-section-rule]', priority: 60 }];
  },

  renderHTML({
    node,
    HTMLAttributes,
  }: {
    node: { attrs: { label?: string; anchorId?: string | null } };
    HTMLAttributes: Record<string, unknown>;
  }) {
    const label = typeof node.attrs.label === 'string' ? node.attrs.label : '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-section-rule': '',
        class: 'article-section-rule',
      }),
      ['span', { class: 'article-section-tag' }, label],
      ['span', { class: 'article-section-line' }],
    ];
  },

  addCommands() {
    return {
      insertSectionRule:
        (attrs: { label: string; anchorId?: string | null }) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: 'sectionRule',
            attrs: {
              label: attrs.label,
              anchorId: attrs.anchorId ?? null,
            },
          }),
    };
  },
});
