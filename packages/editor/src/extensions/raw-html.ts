import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { RawHtmlAttrs } from '../types/index.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    rawHtml: {
      /** Insert a raw HTML escape-hatch block. */
      insertRawHtml: (attrs: RawHtmlAttrs) => ReturnType;
    };
  }
}

/**
 * Escape hatch for journalists: a block holding an arbitrary HTML string. The
 * admin renders a code preview; the public frontend renders the HTML directly
 * after sanitising it. The markup is stored in `data-html`.
 */
export const RawHTML = Node.create({
  name: 'rawHtml',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      html: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-html') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-html':
            typeof attributes['html'] === 'string' ? attributes['html'] : '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-raw-html]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-raw-html': '' })];
  },

  addCommands() {
    return {
      insertRawHtml:
        (attrs: RawHtmlAttrs) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: 'rawHtml', attrs }),
    };
  },
});
