import type { Block } from '../types.js';

// author-bios — a FIELD block: the "About the author(s)" boxes under the
// article. For each typed-in byline author (customFields.authors[]) the
// loader fetches the Author CPT row (same data the /author/<slug> page uses)
// and projects avatar + first bio paragraph; authors whose row is missing
// render name-only. Posts with no typed byline render nothing — the
// admin-user fallback byline only ever shows in the hero, matching the
// hand-built view. Server-side on purpose: the old component fired 1-3
// client/SSR fetches per page view; composing ships the bios in the cached
// payload.

function deriveAuthorSlug(slug: unknown, name: string): string {
  if (typeof slug === 'string' && slug.length > 0) return slug;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// First plain-text paragraph of a Tiptap bio doc (the box wants one line).
function firstParagraph(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const root = doc as { content?: unknown };
  if (!Array.isArray(root.content)) return null;
  for (const node of root.content) {
    if (
      node &&
      typeof node === 'object' &&
      (node as { type?: unknown }).type === 'paragraph'
    ) {
      const inner = (node as { content?: unknown }).content;
      if (!Array.isArray(inner)) continue;
      const text = inner
        .filter(
          (c): c is { type: 'text'; text: string } =>
            !!c &&
            typeof c === 'object' &&
            (c as { type?: unknown }).type === 'text' &&
            typeof (c as { text?: unknown }).text === 'string',
        )
        .map((c) => c.text)
        .join('')
        .trim();
      if (text) return text;
    }
  }
  return null;
}

export const authorBios: Block = {
  meta: {
    key: 'author-bios',
    label: 'Author Bios',
    category: 'article',
    description:
      "'About the author' boxes (avatar, name, first bio line) for the post's byline. Must sit inside a box.",
    icon: 'user',
    kind: 'field',
    fields: [],
    options: [],
  },
  async load(ctx) {
    const box = ctx.box;
    const cf = box?.kind === 'detail' ? box.detail.customFields : {};
    const raw = cf['authors'];
    if (!Array.isArray(raw)) return { authors: [] };

    const byline: Array<{ slug: string; name: string }> = [];
    for (const row of raw) {
      if (row === null || typeof row !== 'object') continue;
      const r = row as { slug?: unknown; name?: unknown };
      const name = typeof r.name === 'string' ? r.name : '';
      if (name.length === 0) continue;
      byline.push({ slug: deriveAuthorSlug(r.slug, name), name });
    }

    const authors = await Promise.all(
      byline.map(async (a) => {
        const detail = await ctx
          .fetchContent('author', a.slug)
          .catch(() => null);
        return {
          slug: a.slug,
          name: a.name,
          photoUrl: detail?.heroImageUrl ?? null,
          bio: firstParagraph(detail?.customFields['bio']),
        };
      }),
    );
    return { authors };
  },
};
