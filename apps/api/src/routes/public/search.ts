import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { objectUrl } from '../../lib/s3.js';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';
import { meili } from '../../lib/meili-client.js';
import {
  CONTENT_INDEX_NAME,
  type ContentDocument,
  type IndexedTaxonomyTerm,
} from '../../lib/meili-indexing.js';

const SLUG_SEGMENT = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*$/i);

const Query = z.object({
  q: z.string().min(1).max(200),
  type: SLUG_SEGMENT.optional(),
  category: SLUG_SEGMENT.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

interface SearchItem {
  id: string;
  title: string;
  slug: string;
  contentTypeSlug: string;
  publishedAt: string | null;
  // authors mirrors the archive/content endpoints' shape. The Meili index
  // currently only carries authorDisplayName, so this is always a single
  // element array (or null) on this path — once the indexer learns the
  // full custom_fields.authors[] array, the shape here doesn't change.
  authors: { displayName: string; slug: string | null }[] | null;
  heroImageUrl: string | null;
  excerpt: string | null;
  featured: boolean;
  taxonomy: IndexedTaxonomyTerm[];
}

interface SearchPayload {
  items: SearchItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function escapeMeiliFilter(value: string): string {
  // Wrap in double quotes; escape any embedded quotes/backslashes. Meili's
  // filter parser accepts quoted strings for values that may contain
  // hyphens, spaces, or anything else parser-significant.
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Anonymous full-text search across published content. Backed by Meilisearch;
 * filters down to the configured public tenant + status="published" + within
 * the publish window. Results match the public archive shape so the same
 * Nuxt card components can render them.
 *
 * pageSize is capped at 50 (unauthenticated). Cached per (q + filters + page)
 * for 5 minutes — same TTL as archive / content. Cache invalidation on
 * content writes is intentionally NOT wired (the index gets the update
 * synchronously and cache TTL bounds the staleness window).
 */
export const publicSearchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['Search'],
        summary: 'Full-text search across published content',
        description:
          'Meilisearch-backed search restricted to status="published" and within the publish window. Filterable by content type and taxonomy term slug. Returns the same item shape as the archive endpoint so the same UI can render either source.',
        operationId: 'searchPublicContent',
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 200 },
            type: { type: 'string' },
            category: { type: 'string' },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: {
              type: 'integer',
              minimum: 1,
              maximum: 50,
              default: 20,
            },
          },
          required: ['q'],
        },
        response: {
          400: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = Query.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'invalid query', issues: parsed.error.issues });
      }
      const { q, type, category, page, pageSize } = parsed.data;
      const tenantId = await resolvePublicTenantId();

      const cacheKey = `cache:search:${tenantId}:${q}:${type ?? '*'}:${category ?? '*'}:${page}:${pageSize}`;

      const payload = await withCache<SearchPayload>(
        cacheKey,
        PUBLIC_CACHE_TTL_SECONDS,
        async () => {
          // now() in seconds — matches publish*AtUnix shape we store.
          const nowSec = Math.floor(Date.now() / 1000);
          const filterClauses = [
            `tenantId = ${escapeMeiliFilter(tenantId)}`,
            `status = "published"`,
            `(publishAtUnix IS NULL OR publishAtUnix <= ${nowSec})`,
            `(unpublishAtUnix IS NULL OR unpublishAtUnix > ${nowSec})`,
          ];
          if (type) {
            filterClauses.push(
              `contentTypeSlug = ${escapeMeiliFilter(type)}`,
            );
          }
          if (category) {
            filterClauses.push(
              `taxonomyTermSlugs = ${escapeMeiliFilter(category)}`,
            );
          }

          let hits: ContentDocument[] = [];
          let total = 0;
          try {
            const result = await meili
              .index(CONTENT_INDEX_NAME)
              .search<ContentDocument>(q, {
                filter: filterClauses,
                limit: pageSize,
                offset: (page - 1) * pageSize,
              });
            hits = result.hits;
            // estimatedTotalHits is what the SDK exposes by default; the
            // exact count would need a separate `totalHits` request mode
            // that costs an extra Meili roundtrip. Good enough for paging.
            total = result.estimatedTotalHits ?? hits.length;
          } catch (err) {
            // Search down → empty result set. The site stays browsable.
            fastify.log.warn(
              { err, q },
              'meili search failed; returning empty results',
            );
          }

          const items: SearchItem[] = await Promise.all(
            hits.map(async (h) => ({
              id: h.id,
              title: h.title,
              slug: h.slug,
              contentTypeSlug: h.contentTypeSlug,
              publishedAt: h.publishedAtUnix
                ? new Date(h.publishedAtUnix * 1000).toISOString()
                : null,
              authors: h.authorDisplayName
                ? [{ displayName: h.authorDisplayName, slug: null }]
                : null,
              heroImageUrl: h.heroImageKey
                ? await objectUrl(h.heroImageKey)
                : null,
              excerpt: h.summary || null,
              featured: h.featured,
              taxonomy: h.taxonomy ?? [],
            })),
          );

          return {
            items,
            pagination: {
              page,
              pageSize,
              total,
              totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
            },
          };
        },
      );

      cacheHeaders(reply);
      return { data: payload };
    },
  );
};
