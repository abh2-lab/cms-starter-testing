import type { Block } from '../types.js';

// post-hero — a FIELD block: the article's dark full-width hero (kicker,
// title, dek, byline/meta chips, hero image stage with caption + credit).
// Coarse on purpose: re-blocking the article must keep pixel parity, so the
// hero stays ONE block whose renderer carries the markup verbatim from the
// old ArticleView hero section. Projects everything from the current box —
// full detail on single-article pages; summary-only boxes (a loop) degrade
// to title/date/image with no kicker/dek/caption.

// Byline entries arrive as customFields.authors[] = { slug?, name }; slug
// was added later, so older rows carry only { name } — derive the same
// kebab-case fallback the theme's authorSlug() helper uses so byline links
// stay aligned with the author pages.
function deriveAuthorSlug(slug: unknown, name: string): string {
  if (typeof slug === 'string' && slug.length > 0) return slug;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function bylineAuthors(
  customFields: Record<string, unknown>,
): Array<{ slug: string; name: string }> {
  const v = customFields['authors'];
  if (!Array.isArray(v)) return [];
  const out: Array<{ slug: string; name: string }> = [];
  for (const row of v) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as { slug?: unknown; name?: unknown };
    const name = typeof r.name === 'string' ? r.name : '';
    if (name.length === 0) continue;
    out.push({ slug: deriveAuthorSlug(r.slug, name), name });
  }
  return out;
}

export const postHero: Block = {
  meta: {
    key: 'post-hero',
    label: 'Post Hero',
    category: 'article',
    description:
      'The article hero: kicker, title, dek, byline/meta chips and the full-width hero image stage. Must sit inside a box.',
    icon: 'sparkles',
    kind: 'field',
    fields: [],
    options: [],
  },
  load(ctx) {
    const box = ctx.box;
    if (!box) return Promise.resolve(null);
    const detail = box.kind === 'detail' ? box.detail : null;
    const cf = detail?.customFields ?? {};
    const str = (k: string): string | null => {
      const v = cf[k];
      return typeof v === 'string' && v.length > 0 ? v : null;
    };
    const rawReading = cf['reading_time_minutes'];
    return Promise.resolve({
      title: box.content.title,
      publishedAt: box.content.publishedAt,
      heroImageUrl: detail?.heroImageUrl ?? box.content.heroImageUrl,
      kicker: str('kicker'),
      subtitle: str('subtitle'),
      heroCaption: str('hero_caption'),
      heroCredit: str('hero_credit'),
      readingTime:
        typeof rawReading === 'number' && rawReading > 0 ? rawReading : null,
      // Typed-in byline (linked names). Empty when the row predates bylines —
      // the renderer then falls back to the plain-text authors label below.
      bylineAuthors: bylineAuthors(cf),
      fallbackAuthors: box.content.authors,
    });
  },
};
