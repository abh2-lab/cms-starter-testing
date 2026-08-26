import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { resolvePageLayout } from '@cms/blocks';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';

// GET /api/public/resolve/:slug
//
// Dispatcher for the flat-URL world. Decode (and any publisher following the
// same convention) serves static pages, category archives and tag archives
// at the publication root — `/about`, `/young-minds`, `/digital-rights` are
// all single-segment URLs. The Nuxt root `[slug].vue` can't know which kind
// of thing a slug refers to without asking the API.
//
// This endpoint runs three lightweight indexed lookups in priority order
// (page → category term → tag term) and returns `{ kind, slug }`. The
// consumer then fetches the full payload from the dedicated endpoint
// (/pages/<slug>, /taxonomy-terms/<taxonomy>/<slug>) based on kind. We
// don't inline the full payload here on purpose:
//   * /pages/<slug> already composes block data via the registry — keeping
//     that logic in one place avoids drift.
//   * The taxonomy-term endpoint already joins the term + owning taxonomy
//     in one call.
//   * Both followups are cached in Dragonfly with the same 300s TTL as
//     this dispatcher, so a hot path costs ~0ms extra over inlining.
//
// Cross-table slug uniqueness across (pages, category terms, tag terms) is
// enforced at admin write time (see lib/slug-collision.ts) so a slug never
// matches more than one kind. Priority order below is defensive only.

const Params = z.object({
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
});

type ResolvedKind = 'page' | 'category' | 'tag';

interface ResolvePayload {
  kind: ResolvedKind | null;
  slug: string;
  // True only for a static page whose layout is chromeless (Blank) — the Nuxt
  // root resolver switches to the `blank` layout (no header/footer) for these.
  // Computed here so the consumer can decide the layout BEFORE render without a
  // second fetch. False for every other kind.
  chromeless: boolean;
}

export const publicResolveRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:slug',
    {
      schema: {
        tags: ['Resolve'],
        summary: 'Identify what kind of entity a flat-URL slug refers to',
        description:
          'Decode-style flat URLs put pages, categories and tags at the publication root. This endpoint tells the consumer which kind of thing `/<slug>` is so it can fetch the full payload from the dedicated endpoint. Priority order is page → category → tag; cross-table uniqueness is enforced at admin write time. Returns kind=null with 200 (not 404) when no match — the consumer renders a frontend 404 to keep static SSR fast. Cached 5 minutes.',
        operationId: 'resolveSlug',
        response: {
          200: {
            description: 'Resolved kind for the slug, or null if unknown',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  kind: {
                    type: ['string', 'null'],
                    enum: ['page', 'category', 'tag', null],
                  },
                  slug: { type: 'string' },
                  chromeless: { type: 'boolean' },
                },
                required: ['kind', 'slug', 'chromeless'],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Invalid slug',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = Params.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid slug' });
      }
      const { slug } = parsed.data;
      const tenantId = await resolvePublicTenantId();

      const payload = await withCache<ResolvePayload>(
        `cache:resolve:${tenantId}:${slug}`,
        PUBLIC_CACHE_TTL_SECONDS,
        async () => {
          // 1) Static or dynamic page in the pages table. Same visibility
          //    filter as /pages/:slug — published, not soft-deleted, current
          //    tenant.
          const [pageRow] = await db
            .select({
              id: schema.pages.id,
              type: schema.pages.type,
              layoutTemplate: schema.pages.layoutTemplate,
            })
            .from(schema.pages)
            .where(
              and(
                eq(schema.pages.tenantId, tenantId),
                eq(schema.pages.slug, slug),
                eq(schema.pages.status, 'published'),
                isNull(schema.pages.deletedAt),
                or(
                  isNull(schema.pages.publishAt),
                  sql`${schema.pages.publishAt} <= now()`,
                ),
                or(
                  isNull(schema.pages.unpublishAt),
                  sql`${schema.pages.unpublishAt} > now()`,
                ),
              ),
            )
            .limit(1);
          if (pageRow) {
            // Chromeless only applies to static pages; dynamic pages always use
            // the standard chrome. resolvePageLayout falls back to 'default'.
            const chromeless =
              pageRow.type === 'static' &&
              resolvePageLayout(pageRow.layoutTemplate).chromeless === true;
            return { kind: 'page', slug, chromeless };
          }

          // 2) Taxonomy term belonging to the 'categories' taxonomy.
          const [categoryRow] = await db
            .select({ id: schema.taxonomyTerms.id })
            .from(schema.taxonomyTerms)
            .innerJoin(
              schema.taxonomies,
              eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
            )
            .where(
              and(
                eq(schema.taxonomies.tenantId, tenantId),
                eq(schema.taxonomies.slug, 'categories'),
                eq(schema.taxonomyTerms.slug, slug),
              ),
            )
            .limit(1);
          if (categoryRow) return { kind: 'category', slug, chromeless: false };

          // 3) Taxonomy term belonging to the 'tags' taxonomy.
          const [tagRow] = await db
            .select({ id: schema.taxonomyTerms.id })
            .from(schema.taxonomyTerms)
            .innerJoin(
              schema.taxonomies,
              eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
            )
            .where(
              and(
                eq(schema.taxonomies.tenantId, tenantId),
                eq(schema.taxonomies.slug, 'tags'),
                eq(schema.taxonomyTerms.slug, slug),
              ),
            )
            .limit(1);
          if (tagRow) return { kind: 'tag', slug, chromeless: false };

          // 4) Nothing matched. Return kind=null with 200 so the consumer can
          //    render a frontend 404 without an extra HTTP cycle on missing
          //    pages. Misses are still cached so a stampede on a 404'd slug
          //    can't drop the DB.
          return { kind: null, slug, chromeless: false };
        },
      );

      cacheHeaders(reply);
      return { data: payload };
    },
  );
};
