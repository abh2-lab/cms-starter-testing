import type { Block } from '../types.js';

// Title Band — the opening band of the portfolio detail page. A PING hero band
// (bright blue with a light-blue curve behind), matching the /brands,
// /platforms and /publishing page heroes so a detail page reads as part of the
// same family. A FIELD block: it reads the current post's title + category from
// the current-post box (the single route sets ctx.box); the .vue paints the
// band and picks the curve from the category.

interface TitleBandData extends Record<string, unknown> {
  title: string | null;
  // The entry's portfolio-categories term: the slug picks the hero curve, the
  // name is the small label above the title. null on entries with no term.
  category: string | null;
  categoryLabel: string | null;
}

export const titleBand: Block<Record<string, unknown>, Record<string, unknown>> =
  {
    meta: {
      key: 'title-band',
      label: 'Title Band',
      category: 'fields',
      description:
        "A full-width PING hero band showing the current post's title, with the curve shaped by its category.",
      icon: 'type',
      kind: 'field',
      fields: [],
      options: [],
    },
    load(ctx): Promise<TitleBandData> {
      const content = ctx.box?.content;
      const term = content?.taxonomy.find(
        (t) => t.taxonomySlug === 'portfolio-categories',
      );
      return Promise.resolve({
        title: content?.title ?? null,
        category: term?.termSlug ?? null,
        categoryLabel: term?.termName ?? null,
      });
    },
  };
