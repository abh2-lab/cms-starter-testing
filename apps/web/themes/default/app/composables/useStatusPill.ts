import type { StoryListItem, TaxonomyTerm } from '~/composables/useCmsFetch';

export type StatusPill = {
  kind: 'featured' | 'verified' | 'trending';
  label: string;
} | null;

const hasTag = (taxonomy: TaxonomyTerm[], slug: string): boolean =>
  taxonomy.some((t) => t.termSlug === slug);

/**
 * Derives the small coloured pill rendered on a story card or sidebar
 * dispatch. Priority: featured > verified > trending. `Trending` is wired
 * to a hardcoded `false` until the Phase 6 view-counter worker fills
 * content.view_count — once that lands the threshold check moves here.
 */
export function useStatusPill(
  item: Pick<StoryListItem, 'featured' | 'taxonomy'>,
): StatusPill {
  if (item.featured) {
    return { kind: 'featured', label: '★ Featured' };
  }
  if (hasTag(item.taxonomy, 'verified')) {
    return { kind: 'verified', label: '✓ Verified' };
  }
  // TODO Phase 6: derive trending from content.view_count threshold.
  const trending = false;
  if (trending) {
    return { kind: 'trending', label: '\u{1F525} Trending' };
  }
  return null;
}

/**
 * Pull the primary category for display on a card. Prefers a term from
 * the configured category taxonomy (defaults to `categories`); falls back
 * to the first taxonomy term.
 */
export function primaryCategory(
  taxonomy: TaxonomyTerm[],
): TaxonomyTerm | null {
  return (
    taxonomy.find((t) => t.taxonomySlug === 'categories') ??
    taxonomy[0] ??
    null
  );
}

/**
 * Pretty-print a publish date as "13 Apr 2026". Returns null when the row
 * has no publishedAt (e.g. drafts surfaced in admin previews).
 *
 * Use for surfaces where the year actually disambiguates — article page
 * masthead, archive list rows, search hits. For card metas where space
 * is tight and the year is implicit ("Recent stories"), use
 * formatPublishDateShort instead.
 */
export function formatPublishDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Short publish-date form for card metas — "13 Apr", no year. Matches the
 * Decode mock's card meta convention ("BY X & Y · 28 NOV"). Returns null
 * for missing/invalid dates so the calling template can drop the segment.
 */
export function formatPublishDateShort(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}
