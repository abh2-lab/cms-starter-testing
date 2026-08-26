/**
 * Pick the public byline(s) for a content row.
 *
 * Article-style CPTs (the Decode Article CPT, for example) store the byline
 * inside `custom_fields.authors[]` so the editor can attribute a piece to a
 * stringer / freelancer who isn't an admin user, including co-bylined work.
 * Shape per CPT:
 *
 *   "authors": [
 *     { "slug": "jaishree-kumar", "name": "Jaishree Kumar" },
 *     { "slug": "ananya-roy",     "name": "Ananya Roy"     }
 *   ]
 *
 * The frontend renders these with " & " between entries, each name linking
 * to its own /author/<slug> detail page. Older or simpler CPTs (or content
 * rows seeded before bylines existed) fall back to the admin user's
 * `displayName` joined from the content row's `author_id` — emitted as a
 * single-element array with `slug: null` (no detail page to link to).
 *
 * Returns `null` when neither source has a name to display.
 */
export interface PickedAuthor {
  displayName: string;
  slug: string | null;
}

export function pickAuthors(
  customFields: Record<string, unknown> | null | undefined,
  fallbackDisplayName: string | null,
): PickedAuthor[] | null {
  const cf = customFields ?? {};
  const authors = cf['authors'];
  if (Array.isArray(authors) && authors.length > 0) {
    const picked: PickedAuthor[] = [];
    for (const entry of authors) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const name = typeof obj['name'] === 'string' ? obj['name'] : null;
      if (!name || name.length === 0) continue;
      const slug = typeof obj['slug'] === 'string' ? obj['slug'] : null;
      picked.push({ displayName: name, slug });
    }
    if (picked.length > 0) return picked;
  }
  if (fallbackDisplayName && fallbackDisplayName.length > 0) {
    return [{ displayName: fallbackDisplayName, slug: null }];
  }
  return null;
}
