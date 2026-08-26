import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';

// GET /api/public/taxonomy-terms/:taxonomySlug/:termSlug
//
// Returns the public name + description for a single taxonomy term, plus the
// owning taxonomy's name + description so the consumer can render a hero row
// without two round trips. The (taxonomy_id, term.slug) pair is unique per
// tenant, so we walk both segments — that disambiguates the rare case where
// a category and a tag share a slug (e.g. /category/tech and /tag/tech).
//
// Used by /category/[slug] and /tag/[slug] on the public Nuxt frontend to
// replace the client-side "kebab-case → Title Case" derivation that was
// shipping before this endpoint existed.

const Params = z.object({
  taxonomySlug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
  termSlug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
});

interface TermPayload {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parent: { id: string; slug: string; name: string } | null;
  taxonomy: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    kind: 'category' | 'tag';
  };
}

export const publicTaxonomyTermsRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  fastify.get(
    '/:taxonomySlug/:termSlug',
    {
      schema: {
        tags: ['Taxonomies'],
        summary: 'Fetch a single taxonomy term by taxonomy + term slug',
        description:
          'Returns the term and its owning taxonomy (id, slug, name, description, kind). Used by /category/<slug> and /tag/<slug> public pages to render a real heading + description instead of deriving from the URL slug. Returns 404 if either the taxonomy or the term is missing. Cached for 5 minutes.',
        operationId: 'getTaxonomyTerm',
        response: {
          200: {
            description: 'Term + taxonomy payload',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  slug: { type: 'string' },
                  name: { type: 'string' },
                  description: {
                    type: ['string', 'null'],
                  },
                  parent: {
                    type: ['object', 'null'],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      slug: { type: 'string' },
                      name: { type: 'string' },
                    },
                    required: ['id', 'slug', 'name'],
                  },
                  taxonomy: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      slug: { type: 'string' },
                      name: { type: 'string' },
                      description: {
                        type: ['string', 'null'],
                      },
                      kind: { type: 'string', enum: ['category', 'tag'] },
                    },
                    required: ['id', 'slug', 'name', 'description', 'kind'],
                  },
                },
                required: [
                  'id',
                  'slug',
                  'name',
                  'description',
                  'parent',
                  'taxonomy',
                ],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Invalid slug',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          404: {
            description: 'Taxonomy or term not found',
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
      const { taxonomySlug, termSlug } = parsed.data;
      const tenantId = await resolvePublicTenantId();

      const payload = await withCache<TermPayload | null>(
        `cache:taxonomy-term:${tenantId}:${taxonomySlug}:${termSlug}`,
        PUBLIC_CACHE_TTL_SECONDS,
        async () => {
          // One join from term → taxonomy keeps this a single round trip.
          // Self-join on taxonomy_terms for parent is conditional, so we do
          // a second lookup only when parentId is set.
          const [row] = await db
            .select({
              termId: schema.taxonomyTerms.id,
              termName: schema.taxonomyTerms.name,
              termDescription: schema.taxonomyTerms.description,
              termParentId: schema.taxonomyTerms.parentId,
              taxonomyId: schema.taxonomies.id,
              taxonomyName: schema.taxonomies.name,
              taxonomyDescription: schema.taxonomies.description,
              taxonomyKind: schema.taxonomies.kind,
            })
            .from(schema.taxonomyTerms)
            .innerJoin(
              schema.taxonomies,
              eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
            )
            .where(
              and(
                eq(schema.taxonomies.tenantId, tenantId),
                eq(schema.taxonomies.slug, taxonomySlug),
                eq(schema.taxonomyTerms.slug, termSlug),
              ),
            )
            .limit(1);

          if (!row) return null;

          let parent: TermPayload['parent'] = null;
          if (row.termParentId !== null) {
            const [parentRow] = await db
              .select({
                id: schema.taxonomyTerms.id,
                slug: schema.taxonomyTerms.slug,
                name: schema.taxonomyTerms.name,
              })
              .from(schema.taxonomyTerms)
              .where(eq(schema.taxonomyTerms.id, row.termParentId))
              .limit(1);
            if (parentRow) parent = parentRow;
          }

          return {
            id: row.termId,
            slug: termSlug,
            name: row.termName,
            description: row.termDescription,
            parent,
            taxonomy: {
              id: row.taxonomyId,
              slug: taxonomySlug,
              name: row.taxonomyName,
              description: row.taxonomyDescription,
              kind: row.taxonomyKind,
            },
          } satisfies TermPayload;
        },
      );

      if (!payload) {
        return reply.code(404).send({ error: 'term not found' });
      }

      cacheHeaders(reply);
      return { data: payload };
    },
  );
};
