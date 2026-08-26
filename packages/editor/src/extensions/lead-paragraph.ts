import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    leadParagraph: {
      /** Toggle the current block between a lead paragraph and a paragraph. */
      toggleLeadParagraph: () => ReturnType;
    };
  }
}

/**
 * The article opener / standfirst: a heavier, bolder paragraph variant living
 * inside the body. Defined as a standalone paragraph-like block (content
 * `inline*`) rather than extending @tiptap/extension-paragraph, to keep the
 * peer-dependency surface minimal. Tagged with `data-lead`.
 */
export const LeadParagraph = Node.create({
  name: 'leadParagraph',
  group: 'block',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'p[data-lead]', priority: 60 }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-lead': '' }), 0];
  },

  addCommands() {
    return {
      toggleLeadParagraph:
        () =>
        ({ commands }: CommandProps) =>
          commands.toggleNode('leadParagraph', 'paragraph'),
    };
  },
});
