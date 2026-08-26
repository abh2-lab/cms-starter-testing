import type { StoryAuthor } from '~/composables/useCmsFetch';

// Helpers for rendering multi-author bylines. The backend's pickAuthors()
// emits an array of {displayName, slug} entries; cards that link each name
// iterate the array directly, but plain-text consumers (RSS, archive list
// rows, og:description fallback) just need a single string.

/**
 * Returns the joined byline as plain text, e.g. "Jaishree Kumar & Ananya
 * Roy" — no "By " prefix. Use in templates as `By {{ authorsLabel(...) }}`
 * so the prefix stays consistent and translateable later.
 *
 * Two-author joins use " & " (the Decode editorial convention). Three or
 * more fall back to ", " separators with a final " & " — so
 * "X, Y & Z" — which is the standard publishing house style for triple-
 * author bylines and what news CMSs typically generate. Returns the empty
 * string when there's nothing to render.
 */
export function authorsLabel(
  authors: StoryAuthor[] | null | undefined,
): string {
  if (!authors || authors.length === 0) return '';
  if (authors.length === 1) return authors[0]!.displayName;
  if (authors.length === 2) {
    return `${authors[0]!.displayName} & ${authors[1]!.displayName}`;
  }
  const head = authors.slice(0, -1).map((a) => a.displayName);
  const last = authors[authors.length - 1]!.displayName;
  return `${head.join(', ')} & ${last}`;
}
