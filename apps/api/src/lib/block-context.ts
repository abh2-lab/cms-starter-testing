import { and, desc, eq, exists, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type {
  BlockContentDetail,
  BlockContentSummary,
  BlockLoadContext,
} from '@cms/blocks';
import { pickAuthors } from './pick-author.js';
import { objectUrl } from './s3.js';
import { resolveMediaRefUrl, resolveMediaRefUrls } from './resolve-media-ref.js';

// Helpers backing the BlockLoadContext that the public composer hands to
// each block.load() call. Kept here (and not inlined in public/pages.ts) so
// the docs generator + tests can build the same context without dragging in
// the rest of the public route plumbing.
//
// Both helpers apply the same published + publish-window visibility filter
// that public/content.ts and public/archive.ts use, so a block loader can
// never accidentally surface a draft or archived row.

// Exported for the composed view routes (public/views.ts), which need the
// SAME visibility window for their totals count as the rows the loop blocks
// fetch — drift here would make "N Stories" disagree with the grid.
export const PUBLISHED_VISIBILITY = (): ReturnType<typeof and> =>
  and(
    eq(schema.content.status, 'published'),
    or(
      isNull(schema.content.publishAt),
      lte(schema.content.publishAt, sql`now()`),
    ),
    or(
      isNull(schema.content.unpublishAt),
      gt(schema.content.unpublishAt, sql`now()`),
    ),
  );

// EXISTS condition: the content row has a taxonomy term with `termSlug`,
// optionally constrained to one taxonomy (by slug). Unscoped matches across
// ALL taxonomies (historical behavior for explicit category pickers); scoped
// is what archive contexts use so a tag and a category sharing a slug don't
// bleed into each other. Shared by fetchArchive below and public/views.ts.
export function termExistsFilter(
  termSlug: string,
  taxonomySlug?: string,
): ReturnType<typeof exists> {
  return exists(
    db
      .select({ one: sql`1` })
      .from(schema.contentTaxonomyTerms)
      .innerJoin(
        schema.taxonomyTerms,
        eq(schema.contentTaxonomyTerms.termId, schema.taxonomyTerms.id),
      )
      .innerJoin(
        schema.taxonomies,
        eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
      )
      .where(
        and(
          eq(schema.contentTaxonomyTerms.contentId, schema.content.id),
          eq(schema.taxonomyTerms.slug, termSlug),
          taxonomySlug ? eq(schema.taxonomies.slug, taxonomySlug) : undefined,
        ),
      ),
  );
}

async function bucketTaxonomy(
  contentIds: string[],
): Promise<Map<string, Array<{ termSlug: string; termName: string; taxonomySlug: string }>>> {
  if (contentIds.length === 0) return new Map();
  const rows = await db
    .select({
      contentId: schema.contentTaxonomyTerms.contentId,
      termSlug: schema.taxonomyTerms.slug,
      termName: schema.taxonomyTerms.name,
      taxonomySlug: schema.taxonomies.slug,
    })
    .from(schema.contentTaxonomyTerms)
    .innerJoin(
      schema.taxonomyTerms,
      eq(schema.contentTaxonomyTerms.termId, schema.taxonomyTerms.id),
    )
    .innerJoin(
      schema.taxonomies,
      eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
    )
    .where(inArray(schema.contentTaxonomyTerms.contentId, contentIds));

  const bucket = new Map<
    string,
    Array<{ termSlug: string; termName: string; taxonomySlug: string }>
  >();
  for (const r of rows) {
    const entry = {
      termSlug: r.termSlug,
      termName: r.termName,
      taxonomySlug: r.taxonomySlug,
    };
    const existing = bucket.get(r.contentId);
    if (existing) existing.push(entry);
    else bucket.set(r.contentId, [entry]);
  }
  return bucket;
}

function pickHeroKey(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object') return null;
  const v = (customFields as Record<string, unknown>)['hero_image_key'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pickExcerpt(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object') return null;
  const v = (customFields as Record<string, unknown>)['excerpt'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Build the BlockLoadContext for a public-page composition. Closes over the
 * tenant id so each block sees ONLY rows that belong to the publisher whose
 * page is being rendered — cross-tenant leakage is impossible by construction.
 */
export function buildBlockContext(opts: {
  tenantId: string;
  locale: string;
}): BlockLoadContext {
  const { tenantId, locale } = opts;

  // Per-context cache of a content type's field definitions, so a tree with
  // many custom-field blocks under one box hits the DB once per type.
  const fieldDefsCache = new Map<
    string,
    Array<{ name: string; label: string; type: string }>
  >();

  return {
    tenantId,
    locale,

    async contentTypeField(typeSlug, fieldKey) {
      let fields = fieldDefsCache.get(typeSlug);
      if (!fields) {
        const [ct] = await db
          .select({ defs: schema.contentTypes.fieldDefinitions })
          .from(schema.contentTypes)
          .where(
            and(
              eq(schema.contentTypes.tenantId, tenantId),
              eq(schema.contentTypes.slug, typeSlug),
            ),
          )
          .limit(1);
        const defs = ct?.defs as unknown;
        const raw =
          defs && typeof defs === 'object'
            ? (defs as { fields?: unknown }).fields
            : undefined;
        fields = Array.isArray(raw)
          ? (raw as Array<{ name: string; label: string; type: string }>)
          : [];
        fieldDefsCache.set(typeSlug, fields);
      }
      const f = fields.find((x) => x.name === fieldKey);
      return f ? { type: f.type, label: f.label } : null;
    },

    async resolveMediaUrl(ref) {
      // Accept a bare key/id (admin picker, seed path) or a ref object that
      // carries one. resolveMediaRefUrl handles both media id and legacy path.
      const obj =
        ref && typeof ref === 'object'
          ? (ref as Record<string, unknown>)
          : null;
      const key =
        typeof ref === 'string'
          ? ref
          : obj
            ? (obj['key'] ?? obj['id'] ?? obj['url'] ?? null)
            : null;
      if (typeof key !== 'string' || key.length === 0) return null;
      return resolveMediaRefUrl(tenantId, key);
    },

    async fetchContent(typeSlug: string, slug: string): Promise<BlockContentDetail | null> {
      const [row] = await db
        .select({
          id: schema.content.id,
          title: schema.content.title,
          slug: schema.content.slug,
          publishedAt: schema.content.publishedAt,
          featured: schema.content.featured,
          customFields: schema.content.customFields,
          authorDisplayName: schema.adminUsers.displayName,
          contentTypeSlug: schema.contentTypes.slug,
          metaTitle: schema.contentSeo.metaTitle,
          metaDescription: schema.contentSeo.metaDescription,
          ogImageKey: schema.contentSeo.ogImageKey,
        })
        .from(schema.content)
        .innerJoin(
          schema.contentTypes,
          eq(schema.content.contentTypeId, schema.contentTypes.id),
        )
        .leftJoin(
          schema.contentSeo,
          eq(schema.contentSeo.contentId, schema.content.id),
        )
        .leftJoin(
          schema.adminUsers,
          eq(schema.content.authorId, schema.adminUsers.id),
        )
        .where(
          and(
            eq(schema.content.tenantId, tenantId),
            eq(schema.contentTypes.slug, typeSlug),
            eq(schema.content.slug, slug),
            PUBLISHED_VISIBILITY(),
          ),
        )
        .limit(1);

      if (!row) return null;

      const heroKey = pickHeroKey(row.customFields);
      // hero_image_key may be a media id (admin picker) or a legacy storage
      // path (seed) — resolveMediaRefUrl handles both.
      const heroImageUrl = heroKey
        ? await resolveMediaRefUrl(tenantId, heroKey)
        : null;
      const ogImageUrl = row.ogImageKey ? await objectUrl(row.ogImageKey) : null;

      // Single-row taxonomy lookup. Cheap enough to keep inline rather than
      // re-using bucketTaxonomy (which optimises the batched archive case).
      const taxonomy = (await bucketTaxonomy([row.id])).get(row.id) ?? [];

      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        type: row.contentTypeSlug,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        authors: pickAuthors(
          row.customFields as Record<string, unknown> | null,
          row.authorDisplayName,
        ),
        heroImageUrl,
        excerpt: pickExcerpt(row.customFields),
        featured: row.featured,
        taxonomy,
        customFields: (row.customFields ?? {}) as Record<string, unknown>,
        seo: {
          metaTitle: row.metaTitle,
          metaDescription: row.metaDescription,
          ogImageUrl,
        },
      };
    },

    async fetchArchive(opts: {
      typeSlug: string;
      category?: string;
      taxonomy?: string;
      tag?: string;
      count: number;
    }): Promise<BlockContentSummary[]> {
      const { typeSlug, category, taxonomy, tag, count } = opts;

      const categoryFilter = category
        ? termExistsFilter(category, taxonomy)
        : undefined;
      // Tag is its own filter, always scoped to the 'tags' taxonomy, ANDed in
      // alongside the category filter (mirrors the public /archive endpoint).
      const tagFilter = tag ? termExistsFilter(tag, 'tags') : undefined;

      const filters = and(
        eq(schema.content.tenantId, tenantId),
        eq(schema.contentTypes.slug, typeSlug),
        PUBLISHED_VISIBILITY(),
        categoryFilter,
        tagFilter,
      );

      const rows = await db
        .select({
          id: schema.content.id,
          title: schema.content.title,
          slug: schema.content.slug,
          publishedAt: schema.content.publishedAt,
          featured: schema.content.featured,
          customFields: schema.content.customFields,
          authorDisplayName: schema.adminUsers.displayName,
          contentTypeSlug: schema.contentTypes.slug,
        })
        .from(schema.content)
        .innerJoin(
          schema.contentTypes,
          eq(schema.content.contentTypeId, schema.contentTypes.id),
        )
        .leftJoin(
          schema.adminUsers,
          eq(schema.content.authorId, schema.adminUsers.id),
        )
        .where(filters)
        // Effective "went live" order — identical to public/archive.ts so a
        // composed archive's page 1 lines up exactly with the raw endpoint's
        // page 2+ (hybrid load-more) and with what the views showed before
        // re-blocking. Manually-published rows have publish_at NULL but
        // published_at set; COALESCE picks whichever exists. The previous
        // plain publish_at DESC sorted those NULLs first (Postgres default),
        // which diverged from the public archive listing. Backed by
        // content_tenant_status_visible_idx.
        .orderBy(
          sql`COALESCE(${schema.content.publishAt}, ${schema.content.publishedAt}) DESC NULLS LAST`,
          desc(schema.content.id),
        )
        .limit(count);

      const taxonomyByContent = await bucketTaxonomy(rows.map((r) => r.id));
      // Resolve every row's hero in ONE media lookup (handles id + legacy path).
      const heroUrlByKey = await resolveMediaRefUrls(
        tenantId,
        rows.map((r) => pickHeroKey(r.customFields)),
      );

      return rows.map((r) => {
        const heroKey = pickHeroKey(r.customFields);
        const heroImageUrl = heroKey ? (heroUrlByKey.get(heroKey) ?? null) : null;
        return {
          id: r.id,
          title: r.title,
          slug: r.slug,
          type: r.contentTypeSlug,
          publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
          authors: pickAuthors(
            r.customFields as Record<string, unknown> | null,
            r.authorDisplayName,
          ),
          heroImageUrl,
          excerpt: pickExcerpt(r.customFields),
          featured: r.featured,
          taxonomy: taxonomyByContent.get(r.id) ?? [],
        };
      });
    },
  };
}
