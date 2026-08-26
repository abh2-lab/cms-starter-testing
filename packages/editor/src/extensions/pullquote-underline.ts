import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pullquoteUnderline: {
      /** Toggle the current block between an underline pull-quote and a paragraph. */
      togglePullquoteUnderline: () => ReturnType;
    };
  }
}

/**
 * The smaller, in-flow pull-quote variant used in the Decode mock — a single
 * paragraph with a red dot bullet and an underline, distinct from the heavy
 * decorative {@link PullQuote}. Holds inline content; the dot + underline are
 * the renderer's job (CSS lives in apps/web/app/pages/article/[slug].vue).
 *
 * Tagged with `data-pullquote-underline` so it parses back unambiguously and
 * can't be confused with a regular paragraph or the heavier PullQuote.
 */
export const PullquoteUnderline = Node.create({
  name: 'pullquoteUnderline',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'p[data-pullquote-underline]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'p',
      mergeAttributes(HTMLAttributes, {
        'data-pullquote-underline': '',
        class: 'article-pullquote-underline',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      togglePullquoteUnderline:
        () =>
        ({ commands }: CommandProps) =>
          commands.toggleNode('pullquoteUnderline', 'paragraph'),
    };
  },
});
