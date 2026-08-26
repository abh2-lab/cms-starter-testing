import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pullQuote: {
      /** Toggle the current block between a pull quote and a paragraph. */
      togglePullQuote: () => ReturnType;
    };
  }
}

/**
 * The large, decoratively-styled quote used in news articles — distinct from a
 * blockquote. Holds inline content; styling/quotation marks are the renderer's
 * job. Tagged with `data-pullquote` so it parses back unambiguously.
 */
export const PullQuote = Node.create({
  name: 'pullQuote',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'blockquote[data-pullquote]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['blockquote', mergeAttributes(HTMLAttributes, { 'data-pullquote': '' }), 0];
  },

  addCommands() {
    return {
      togglePullQuote:
        () =>
        ({ commands }: CommandProps) =>
          commands.toggleNode('pullQuote', 'paragraph'),
    };
  },
});
