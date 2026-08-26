import type { FastifyPluginAsync } from 'fastify';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { resolveMediaRefUrls } from '../../lib/resolve-media-ref.js';
import { pickAuthors } from '../../lib/pick-author.js';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';

const SLUG_SEGMENT = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*$/i);

// The hero image lives in custom_fields under this exact name by convention —
// same reader as pickHeroKey in lib/block-context.ts, so the two paths agree on
// what counts as a hero.
function pickHeroImageKey(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object') return null;
  const v = (customFields as Record<string, unknown>)['hero_image_key'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const Params = z.object({ type: SLUG_SEGMENT });
const Query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // Optional taxonomy-term slug filter. Matches against any taxonomy term
  // (across all taxonomies) attached to a content row.
  category: SLUG_SEGMENT.optional(),
  // Optional tag-slug filter. Same shape as `category`, but constrained to
  // taxonomy.slug = 'tags' — so a tag term that happens to share a slug
  // with a category term (rare but possible) doesn't bleed across the two
  // archive views.
  tag: SLUG_SEGMENT.optional(),
  // Optional author-slug filter. Matches against any entry in
  // custom_fields.authors[] with a matching `slug`. Per the Article CPT
  // shape (see apps/api/fixtures/decode/content-types.json), each author
  // entry is `{slug, name}`; rows seeded before slugs were added carry only
  // `{name}` and won't match — re-seed if you need them covered.
  author: SLUG_SEGMENT.optional(),
  // Opt-in inclusion of expensive fat-row fields. Default response stays
  // lean (id, title, slug, hero, excerpt, taxonomy) so the home page and
  // generic archive grids don't pay for fields they never read. The
  // /authors index needs custom_fields per row to render role/bio/socials
  // without a per-row detail fetch — it sets ?include=customFields.
  //
  // Comma-separated so this can extend later (?include=customFields,
  // bodyExcerpt) without breaking the enum check.
  include: z.enum(['customFields']).optional(),
  // Ordering. 'newest' (default) sorts by effective publish time, newest first.
  // 'order' sorts by the editor-set sort_order ascending, for lists an admin
  // arranges by hand (the team grid). A stable id tiebreak keeps pagination
  // deterministic in both modes.
  sort: z.enum(['newest', 'order']).default('newest'),
});

interface TaxonomyTermPayload {
  termSlug: string;
  termName: string;
  taxonomySlug: string;
}

interface ArchiveItem {
  id: string;
  title: string;
  slug: string;
  publishedAt: string | null;
  // authors is picked by pickAuthors(): prefer the full
  // custom_fields.authors[] array (each entry → /author/<slug>), fall back
  // to a single-element array with the admin user's displayName when no
  // byline is set. slug is null when the fallback path runs. null when
  // neither source has a name.
  authors: { displayName: string; slug: string | null }[] | null;
  heroImageUrl: string | null;
  excerpt: string | null;
  featured: boolean;
  taxonomy: TaxonomyTermPayload[];
  // First taxonomy term where taxonomySlug === 'categories' — used by the
  // flat-URL frontend to build canonical /<category>/<article> links from
  // archive list data without a second fetch. null when the row has no
  // category term (the frontend falls back to /uncategorized/<slug>; the
  // category-required-on-publish gate from commit 2.1 keeps that rare).
  primaryCategorySlug: string | null;
  // Present only when the request opts in via ?include=customFields.
  // Callers that need fields beyond the lean default (e.g. /authors which
  // needs role + bio + socials) pull this in to skip a per-row detail
  // fetch. Default callers never see this key, keeping payloads small.
  customFields?: Record<string, unknown>;
}

interface ArchivePayload {
  items: ArchiveItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Anonymous public archive listing — paginated published-content browse keyed
 * by content_type slug. Same three-condition visibility filter as the detail
 * endpoint. pageSize is capped at 100 because this is unauthenticated.
 */
export const publicArchiveRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:type',
    {
      schema: {
        tags: ['Archive'],
        summary: 'List published content of a given type',
        description:
          'Paginated archive listing for a content type. Same visibility window as the content detail endpoint. pageSize is capped at 100 because this endpoint is unauthenticated; results sort newest-first by COALESCE(publish_at, published_at). Each item carries the resolved hero image URL and any taxonomy terms attached to it. An optional `category` query parameter filters by any taxonomy term slug attached to the row. Cached per (type, category, page, pageSize) for 5 minutes; invalidated on any admin write to a content row of this type.',
        operationId: 'listArchiveByType',
        response: {
          200: {
            description: 'Page of published items + pagination metadata',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        title: { type: 'string' },
                        slug: { type: 'string' },
                        publishedAt: {
                          type: 'string',
                          format: 'date-time',
                          nullable: true,
                        },
                        authors: {
                          type: 'array',
                          nullable: true,
                          items: {
                            type: 'object',
                            properties: {
                              displayName: { type: 'string' },
                              // null when the byline came from the admin-
                              // user fallback path (no slug to link to).
                              // Declared so fast-json-stringify doesn't
                              // strip it mid-flight.
                              slug: { type: 'string', nullable: true },
                            },
                            required: ['displayName', 'slug'],
                          },
                        },
                        heroImageUrl: { type: 'string', nullable: true },
                        excerpt: { type: 'string', nullable: true },
                        featured: {
                          type: 'boolean',
                          description:
                            'Editorially marked as featured. Drives the "Featured" status pill on cards.',
                        },
                        taxonomy: {
                          type: 'array',
                          items: { $ref: 'TaxonomyTerm#' },
                        },
                        // First taxonomy term whose taxonomy slug is
                        // 'categories', or null if the row has no category.
                        // Declared so fast-json-stringify doesn't strip it.
                        primaryCategorySlug: {
                          type: 'string',
                          nullable: true,
                        },
                        // Only emitted when the caller passes
                        // ?include=customFields. Shape is per-CPT, so the
                        // schema stays open (additionalProperties: true) and
                        // Fastify's fast-json-stringify won't strip the
                        // jsonb payload mid-flight.
                        customFields: {
                          type: 'object',
                          additionalProperties: true,
                          nullable: true,
                        },
                      },
                      required: [
                        'id',
                        'title',
                        'slug',
                        'heroImageUrl',
                        'featured',
                        'taxonomy',
                        'primaryCategorySlug',
                      ],
                    },
                  },
                  pagination: {
                    type: 'object',
                    properties: {
                      page: { type: 'integer' },
                      pageSize: { type: 'integer' },
                      total: { type: 'integer' },
                      totalPages: { type: 'integer' },
                    },
                    required: ['page', 'pageSize', 'total', 'totalPages'],
                  },
                },
                required: ['items', 'pagination'],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Invalid type segment or pagination parameters',
            type: 'object',
            properties: {
              error: { type: 'string' },
              issues: {
                type: 'object',
                additionalProperties: true,
                nullable: true,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
    const params = Params.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid type' });
    }
    const query = Query.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        error: 'invalid pagination',
        issues: query.error.flatten(),
      });
    }
    const { type } = params.data;
    const { page, pageSize, category, tag, author, include, sort } = query.data;

    const tenantId = await resolvePublicTenantId();

    // Manual-order opt-in: when this content type has settings.manualOrder, its
    // listing is arranged by hand — force sort_order regardless of the ?sort
    // param. Resolve the flag BEFORE withCache so it feeds the cache key (else an
    // order-sorted response could be stored under a 'newest'-labelled key). One
    // indexed slug lookup; the OR tolerates global (null-tenant) content types.
    const [orderTypeRow] = await db
      .select({ settings: schema.contentTypes.settings })
      .from(schema.contentTypes)
      .where(
        and(
          eq(schema.contentTypes.slug, type),
          or(
            eq(schema.contentTypes.tenantId, tenantId),
            isNull(schema.contentTypes.tenantId),
          ),
        ),
      )
      .limit(1);
    const manualOrder =
      (orderTypeRow?.settings as { manualOrder?: unknown } | null | undefined)
        ?.manualOrder === true;
    const effectiveSort = manualOrder ? 'order' : sort;

    // Cache key includes the include token so a lean default response and a
    // fat ?include=customFields response don't share an entry — otherwise
    // whichever variant lands in Redis first would mask the other.
    const payload = await withCache<ArchivePayload>(
      `cache:archive:${tenantId}:${type}:${category ?? '_all'}:${tag ?? '_all'}:${author ?? '_all'}:${include ?? '_none'}:${effectiveSort}:${page}:${pageSize}`,
      PUBLIC_CACHE_TTL_SECONDS,
      async () => {
        // Same publish-window filter as the detail endpoint. Kept inline so
        // the visibility logic stays auditable from the query. publish_at is
        // NULL for directly-published content (the transitions handler only
        // sets published_at); a non-null publish_at means scheduled, which
        // becomes visible once due.
        //
        // category, when set, narrows to rows that have a taxonomy term with
        // matching slug (any taxonomy). EXISTS subquery keeps the result-set
        // distinct without GROUP BY.
        const categoryFilter = category
          ? exists(
              db
                .select({ one: sql`1` })
                .from(schema.contentTaxonomyTerms)
                .innerJoin(
                  schema.taxonomyTerms,
                  eq(
                    schema.contentTaxonomyTerms.termId,
                    schema.taxonomyTerms.id,
                  ),
                )
                .where(
                  and(
                    eq(
                      schema.contentTaxonomyTerms.contentId,
                      schema.content.id,
                    ),
                    eq(schema.taxonomyTerms.slug, category),
                  ),
                ),
            )
          : undefined;

        // tag mirrors categoryFilter but adds a join on `taxonomies` so the
        // match is constrained to taxonomy.slug = 'tags'. Two contentful
        // publishers could legally have a `voices` category and a `voices`
        // tag — without this constraint, both URLs would surface the same
        // rows.
        const tagFilter = tag
          ? exists(
              db
                .select({ one: sql`1` })
                .from(schema.contentTaxonomyTerms)
                .innerJoin(
                  schema.taxonomyTerms,
                  eq(
                    schema.contentTaxonomyTerms.termId,
                    schema.taxonomyTerms.id,
                  ),
                )
                .innerJoin(
                  schema.taxonomies,
                  eq(
                    schema.taxonomyTerms.taxonomyId,
                    schema.taxonomies.id,
                  ),
                )
                .where(
                  and(
                    eq(
                      schema.contentTaxonomyTerms.contentId,
                      schema.content.id,
                    ),
                    eq(schema.taxonomyTerms.slug, tag),
                    eq(schema.taxonomies.slug, 'tags'),
                  ),
                ),
            )
          : undefined;

        // author, when set, narrows to rows whose `custom_fields.authors`
        // jsonb array contains an entry matching `{slug: ?}`. Postgres'
        // structural containment (`@>`) — meaning any author entry that
        // has the right slug among its keys is a match (extra fields like
        // `name` don't break it). Drizzle's sql template parameter-binds
        // the slug, so no injection risk from the query string.
        const authorFilter = author
          ? sql`${schema.content.customFields}->'authors' @> ${JSON.stringify([{ slug: author }])}::jsonb`
          : undefined;

        const filters = and(
          eq(schema.content.tenantId, tenantId),
          eq(schema.contentTypes.slug, type),
          eq(schema.content.status, 'published'),
          or(
            isNull(schema.content.publishAt),
            lte(schema.content.publishAt, sql`now()`),
          ),
          or(
            isNull(schema.content.unpublishAt),
            gt(schema.content.unpublishAt, sql`now()`),
          ),
          categoryFilter,
          tagFilter,
          authorFilter,
        );

        const [countRow] = await db
          .select({ total: sql<number>`count(*)::int` })
          .from(schema.content)
          .innerJoin(
            schema.contentTypes,
            eq(schema.content.contentTypeId, schema.contentTypes.id),
          )
          .where(filters);

        const total = countRow?.total ?? 0;

        const rows = await db
          .select({
            id: schema.content.id,
            title: schema.content.title,
            slug: schema.content.slug,
            publishedAt: schema.content.publishedAt,
            featured: schema.content.featured,
            customFields: schema.content.customFields,
            authorDisplayName: schema.adminUsers.displayName,
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
          // Sort by the row's effective "went live" timestamp. Manually-
          // published rows from seed have publish_at = NULL but published_at
          // set; scheduled-then-published rows have publish_at populated.
          // COALESCE picks whichever is present, keeping the list newest-
          // first regardless of which path published the row. Backed by the
          // functional index content_tenant_status_visible_idx so the planner
          // can still use an Index Scan instead of a Sort.
          .orderBy(
            ...(effectiveSort === 'order'
              ? // Editor-arranged order (manual-order types): sort_order asc,
                // newest id as a stable tiebreak for equal orders.
                [asc(schema.content.sortOrder), desc(schema.content.id)]
              : // Default: newest-first by effective publish time.
                [
                  sql`COALESCE(${schema.content.publishAt}, ${schema.content.publishedAt}) DESC NULLS LAST`,
                  desc(schema.content.id),
                ]),
          )
          .limit(pageSize)
          .offset((page - 1) * pageSize);

        // Single batched taxonomy lookup for the page, bucketed by contentId
        // — avoids N+1 queries when the page has many items with terms.
        const contentIds = rows.map((r) => r.id);
        const termRows =
          contentIds.length > 0
            ? await db
                .select({
                  contentId: schema.contentTaxonomyTerms.contentId,
                  termSlug: schema.taxonomyTerms.slug,
                  termName: schema.taxonomyTerms.name,
                  taxonomySlug: schema.taxonomies.slug,
                })
                .from(schema.contentTaxonomyTerms)
                .innerJoin(
                  schema.taxonomyTerms,
                  eq(
                    schema.contentTaxonomyTerms.termId,
                    schema.taxonomyTerms.id,
                  ),
                )
                .innerJoin(
                  schema.taxonomies,
                  eq(
                    schema.taxonomyTerms.taxonomyId,
                    schema.taxonomies.id,
                  ),
                )
                .where(
                  inArray(schema.contentTaxonomyTerms.contentId, contentIds),
                )
            : [];

        const taxonomyByContent = new Map<string, TaxonomyTermPayload[]>();
        for (const t of termRows) {
          const entry = {
            termSlug: t.termSlug,
            termName: t.termName,
            taxonomySlug: t.taxonomySlug,
          };
          const bucket = taxonomyByContent.get(t.contentId);
          if (bucket) bucket.push(entry);
          else taxonomyByContent.set(t.contentId, [entry]);
        }

        // Resolve every row's hero in ONE media lookup, BEFORE the row map.
        // A hero_image_key is either a media id (what the admin picker saves)
        // or a raw storage path (legacy seed data); only resolveMediaRefUrls
        // knows the difference. This route used to hand the raw value straight
        // to objectUrl(), which signs it as an object path — so every
        // picker-set image produced a URL that could only 404, while the same
        // content rendered fine through a block loader, which has always gone
        // through this resolver (see lib/block-context.ts). Batched here rather
        // than per row so a 100-item page still costs one query, not 100.
        const heroUrlByKey = await resolveMediaRefUrls(
          tenantId,
          rows.map((r) => pickHeroImageKey(r.customFields)),
        );

        const items: ArchiveItem[] = await Promise.all(
          rows.map(async (row) => {
            const customFields = (row.customFields ?? {}) as Record<
              string,
              unknown
            >;
            const heroImageKey = pickHeroImageKey(row.customFields);
            if (!heroImageKey) {
              // Surfaces content types using a different image field name so
              // we can fix the convention before the frontend launches.
              fastify.log.warn(
                { slug: row.slug, contentType: type },
                `archive item ${row.slug} (type: ${type}) has no hero_image_key in customFields`,
              );
            }
            const rawExcerpt = customFields['excerpt'];
            const excerpt =
              typeof rawExcerpt === 'string' ? rawExcerpt : null;
            // null when the key names a media row that no longer exists —
            // the renderer degrades to "no image" instead of a doomed URL.
            const heroImageUrl = heroImageKey
              ? (heroUrlByKey.get(heroImageKey) ?? null)
              : null;
            const terms = taxonomyByContent.get(row.id) ?? [];
            // Primary category = first term in the 'categories' taxonomy on
            // this row. Tags are not category candidates. Frontend uses this
            // to build canonical /<category>/<article> URLs from list data.
            const primaryCategorySlug =
              terms.find((t) => t.taxonomySlug === 'categories')?.termSlug ??
              null;
            const item: ArchiveItem = {
              id: row.id,
              title: row.title,
              slug: row.slug,
              publishedAt: row.publishedAt
                ? row.publishedAt.toISOString()
                : null,
              authors: pickAuthors(customFields, row.authorDisplayName),
              heroImageUrl,
              excerpt,
              featured: row.featured,
              taxonomy: terms,
              primaryCategorySlug,
            };
            if (include === 'customFields') {
              item.customFields = customFields;
            }
            return item;
          }),
        );

        return {
          items,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        };
      },
    );

    cacheHeaders(reply);
    return { data: payload };
  });
};
