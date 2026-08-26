import type { Block } from '../types.js';

// archive-title — a FIELD block that reads the ARCHIVE context (the category/tag
// term being browsed), not a post box. Set on archive templates via ctx.archive.
// Renders nothing when there is no archive context.

export const archiveTitle: Block = {
  meta: {
    key: 'archive-title',
    label: 'Archive Title',
    category: 'fields',
    description:
      'Renders the title (and optional description) of the archive being browsed.',
    icon: 'folder',
    kind: 'field',
    fields: [],
    options: [],
  },
  load(ctx) {
    return Promise.resolve({
      title: ctx.archive?.title ?? null,
      description: ctx.archive?.description ?? null,
    });
  },
};
