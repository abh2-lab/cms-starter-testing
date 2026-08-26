// Slug-to-id resolvers. Each seeder phase calls `prime*` after its inserts to
// populate the resolver, so later phases can look up FK ids by the same slugs
// the JSON fixture uses. Misses throw immediately with a clear pointer at the
// offending slug — fixtures that reference a missing parent fail loud rather
// than writing dangling rows.

export class SlugResolver {
  private readonly contentTypes = new Map<string, string>();
  private readonly taxonomies = new Map<string, string>();
  // Composite key: `${taxonomySlug}::${termSlug}` — keeps lookups O(1) without
  // a nested Map.
  private readonly terms = new Map<string, string>();
  private readonly contents = new Map<string, string>();
  private readonly menus = new Map<string, string>();
  private readonly mediaByFilename = new Map<string, { storageKey: string; mediaId: string }>();

  primeContentType(slug: string, id: string): void {
    this.contentTypes.set(slug, id);
  }

  primeTaxonomy(slug: string, id: string): void {
    this.taxonomies.set(slug, id);
  }

  primeTerm(taxonomySlug: string, termSlug: string, id: string): void {
    this.terms.set(`${taxonomySlug}::${termSlug}`, id);
  }

  primeContent(typeSlug: string, slug: string, id: string): void {
    this.contents.set(`${typeSlug}::${slug}`, id);
  }

  primeMenu(slug: string, id: string): void {
    this.menus.set(slug, id);
  }

  // Media is keyed by FILENAME (the fixture-space name in media.json), which
  // is intentionally human-readable so JSON fixtures can reference images by
  // the same name a person would. Resolves to the actual `storage_key` (and
  // the media row id, for future use cases like content_relation fields).
  primeMedia(filename: string, value: { storageKey: string; mediaId: string }): void {
    this.mediaByFilename.set(filename, value);
  }

  media(filename: string): { storageKey: string; mediaId: string } {
    const v = this.mediaByFilename.get(filename);
    if (!v) {
      throw new Error(
        `Unknown media filename "${filename}" — must be defined in media.json`,
      );
    }
    return v;
  }

  // Used by validate.ts so it can report missing references without throwing
  // — the validator collects every issue, then throws once.
  hasMedia(filename: string): boolean {
    return this.mediaByFilename.has(filename);
  }

  // Walk any value recursively and replace `{$media: "filename"}` sentinels
  // with the resolved storage_key string. Used by seed-posts / seed-pages /
  // seed-site-settings to pre-process custom_fields / seo / blocks payloads
  // before insertion. The fixture references a media filename; the public
  // renderer needs a storage_key (which it converts to a URL via objectUrl).
  resolveSentinels(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveSentinels(v));
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      keys.length === 1 &&
      keys[0] === '$media' &&
      typeof obj['$media'] === 'string'
    ) {
      return this.media(obj['$media']).storageKey;
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = this.resolveSentinels(obj[k]);
    }
    return out;
  }

  contentType(slug: string): string {
    const id = this.contentTypes.get(slug);
    if (!id) {
      throw new Error(`Unknown content_type_slug "${slug}" — must be defined in content-types.json`);
    }
    return id;
  }

  taxonomy(slug: string): string {
    const id = this.taxonomies.get(slug);
    if (!id) {
      throw new Error(`Unknown taxonomy_slug "${slug}" — must be defined in taxonomies.json`);
    }
    return id;
  }

  term(taxonomySlug: string, termSlug: string): string {
    const id = this.terms.get(`${taxonomySlug}::${termSlug}`);
    if (!id) {
      throw new Error(
        `Unknown term "${termSlug}" in taxonomy "${taxonomySlug}" — must be defined in taxonomies.json`,
      );
    }
    return id;
  }

  // Soft lookup — menu items may legitimately reference content that isn't in
  // the fixture (e.g. a "Home" link to "/"). Caller decides what to do with null.
  contentOrNull(typeSlug: string, slug: string): string | null {
    return this.contents.get(`${typeSlug}::${slug}`) ?? null;
  }

  menu(slug: string): string {
    const id = this.menus.get(slug);
    if (!id) {
      throw new Error(`Unknown menu_slug "${slug}"`);
    }
    return id;
  }
}

// Walk an arbitrary value and collect every $media filename referenced.
// Used by validate.ts to check refs against the parsed media.json BEFORE any
// DB write or upload. Kept as a free function (not a SlugResolver method)
// because validate runs before the resolver is populated.
export function collectMediaSentinels(value: unknown, into: Set<string>): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) collectMediaSentinels(v, into);
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (
    keys.length === 1 &&
    keys[0] === '$media' &&
    typeof obj['$media'] === 'string'
  ) {
    into.add(obj['$media']);
    return;
  }
  for (const k of keys) collectMediaSentinels(obj[k], into);
}
