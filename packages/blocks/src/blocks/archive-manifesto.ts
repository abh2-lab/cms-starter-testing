import type { Block } from '../types.js';

// archive-manifesto — a FIELD block that reads the ARCHIVE context: the
// category sidebar's heading stack (small label, the term name split across
// two visual lines by the renderer, term description, and the owning
// taxonomy's description as a sub-line). Renders nothing when there is no
// archive context.

interface ArchiveManifestoFields {
  label?: string;
}

export const archiveManifesto: Block<
  ArchiveManifestoFields,
  Record<string, unknown>
> = {
  meta: {
    key: 'archive-manifesto',
    label: 'Archive Manifesto',
    category: 'archive',
    description:
      'Sidebar heading for the browsed term: label, large split title, description and taxonomy sub-line.',
    icon: 'type',
    kind: 'field',
    fields: [
      {
        key: 'label',
        label: 'Label',
        type: 'short_text',
        default: 'Archive',
        helpText: 'The small uppercase label above the term name.',
      },
    ],
    options: [],
  },
  load(ctx) {
    return Promise.resolve({
      title: ctx.archive?.title ?? null,
      description: ctx.archive?.description ?? null,
      taxonomyDescription: ctx.archive?.taxonomyDescription ?? null,
    });
  },
};
