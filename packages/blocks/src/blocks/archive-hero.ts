import type { Block } from '../types.js';

// archive-hero — a FIELD block that reads the ARCHIVE context: the dark
// tag-archive banner (kicker, red-hash title, description, story count). The
// renderer strips whitespace from the title for the #HashTag display, so the
// loader hands over the human display name untouched. Renders nothing when
// there is no archive context.

interface ArchiveHeroFields {
  kicker?: string;
}

export const archiveHero: Block<ArchiveHeroFields, Record<string, unknown>> = {
  meta: {
    key: 'archive-hero',
    label: 'Archive Hero',
    category: 'archive',
    description:
      'Dark hero banner for the browsed term: kicker, hash-tag title, description and story count.',
    icon: 'star',
    kind: 'field',
    fields: [
      {
        key: 'kicker',
        label: 'Kicker',
        type: 'short_text',
        default: 'Tag',
        helpText: 'The small uppercase label above the title.',
      },
    ],
    options: [],
  },
  load(ctx) {
    return Promise.resolve({
      title: ctx.archive?.title ?? null,
      description: ctx.archive?.description ?? null,
      total: ctx.archive?.total ?? null,
    });
  },
};
