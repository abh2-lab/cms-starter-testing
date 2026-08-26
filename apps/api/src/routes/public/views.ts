import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import {
  resolveTemplate,
  type ArchiveContext,
  type PageBlockInstance,
} from '@cms/blocks';
import {
  composeBlocks,
  type ComposedBlock,
} from '../../lib/compose-blocks.js';
import { resolveThemeBlocks } from '../../lib/theme-overrides.js';
import { verifyThemePreviewToken } from '../../lib/preview-token.js';
import {
  buildBlockContext,
  PUBLISHED_VISIBILITY,
  termExistsFilter,
} from '../../lib/block-context.js';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';

// GET /api/public/views/archive/:taxonomySlug/:termSlug
//
// Composed archive view (theme engine v1.5): resolves the browsed term, picks
// the archive template variant (category vs tag — see resolveTemplate), sets
// ctx.archive, and composes the template's block tree. The category/tag pages
// render this tree through BlockTree instead of their hand-built chrome.
//
// Always composes PAGE 1. Load-more stays on the raw /api/public/archive
// endpoint (hybrid pagination): the view shell appends raw items as ScardCard
// — the same component the post-card block wraps — into the same grid, so
// appended cards are pixel-identical to composed ones by construction.
// `pagination` here tells the shell the loop's page size + the term's total
// so its load-more requests line up with what the loop composed.
//
// Unregistered terms do NOT 404: the title/description fall back to the
// kebab-case derivation the views shipped before this endpoint existed, so
// /some-unregistered-term still renders a (possibly empty) archive.

const SLUG_SEGMENT = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*$/i);

const Params = z.object({
  taxonomySlug: SLUG_SEGMENT,
  termSlug: SLUG_SEGMENT,
});

const Query = z.object({
  // Theme-preview token (structure-editor drafts, theme engine v2.0) — makes
  // archive template resolution see DRAFT overrides and bypasses the cache.
  theme_preview: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .optional(),
});

interface ArchiveViewPayload {
  archive: {
    title: string;
    termSlug: string;
    taxonomySlug: string;
    description: string | null;
    taxonomyDescription: string | null;
    total: number;
  };
  blocks: ComposedBlock[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// System pages (theme engine v2 Phase 4) — 404 / search / authors / contact,
// composed from their override-backed role template. The interactive bits
// (the search query, the contact POST, the author fetch+filter) live in the
// block COMPONENTS and read the URL / call their own endpoints; this view only
// supplies the editable block tree, so the payload is just the composed blocks.
const SYSTEM_ROLES = ['search', '404', 'authors', 'contact'] as const;

const SystemParams = z.object({
  role: z.enum(SYSTEM_ROLES),
});

interface SystemViewPayload {
  role: (typeof SYSTEM_ROLES)[number];
  blocks: ComposedBlock[];
}

// "digital-state" → "Digital State". The display fallback the archive views
// used client-side before composition moved server-side — kept byte-identical
// so unregistered terms render the same heading they did before re-blocking.
function kebabToTitle(slug: string): string {
  return slug
    .split('-')
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

// Pull the first query-loop's content_type + count out of the resolved
// template so the shell's load-more pages match what page 1 composed. When a
// (future) override drops the loop entirely, the defaults keep pagination
// metadata sane.
interface LoopParams {
  contentType: string;
  pageSize: number;
}

function findLoop(instances: PageBlockInstance[]): LoopParams | null {
  for (const inst of instances) {
    if (inst.block_key === 'query-loop') {
      const rawType = inst.options['content_type'];
      const contentType =
        typeof rawType === 'string' && rawType.length > 0 ? rawType : 'article';
      const rawCount = Number(inst.options['count']);
      const pageSize =
        Number.isFinite(rawCount) && rawCount >= 1 ? Math.floor(rawCount) : 12;
      return { contentType, pageSize };
    }
    if (inst.children?.length) {
      const nested = findLoop(inst.children);
      if (nested) return nested;
    }
  }
  return null;
}

function findLoopParams(instances: PageBlockInstance[]): LoopParams {
  return findLoop(instances) ?? { contentType: 'article', pageSize: 12 };
}

export const publicViewsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/archive/:taxonomySlug/:termSlug',
    {
      schema: {
        tags: ['Views'],
        summary: 'Composed archive view for a taxonomy term',
        description:
          'Resolves the browsed term, selects the archive template variant for the taxonomy (category vs tag), and returns the composed block tree plus the term metadata and page-1 pagination. Unregistered terms fall back to a kebab-case-derived title instead of 404ing. Load-more pages come from the raw /archive endpoint. Cached for 5 minutes.',
        operationId: 'getArchiveView',
        response: {
          200: {
            description: 'Composed archive view payload',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  archive: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      termSlug: { type: 'string' },
                      taxonomySlug: { type: 'string' },
                      description: { type: 'string', nullable: true },
                      taxonomyDescription: {
                        type: 'string',
                        nullable: true,
                      },
                      total: { type: 'integer' },
                    },
                    required: [
                      'title',
                      'termSlug',
                      'taxonomySlug',
                      'description',
                      'taxonomyDescription',
                      'total',
                    ],
                  },
                  // Composed template tree. Open objects so the nested
                  // (machine-generated) ComposedBlock shape — incl. recursive
                  // `children` and per-block `data` — passes verbatim, same
                  // escape hatch as the content route's blocks.
                  blocks: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
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
                required: ['archive', 'blocks', 'pagination'],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Invalid slug segment',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          401: {
            description: 'Invalid theme-preview token',
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
      const queryParsed = Query.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'invalid query' });
      }
      let themeDraft = false;
      if (queryParsed.data.theme_preview) {
        if (!verifyThemePreviewToken(queryParsed.data.theme_preview)) {
          return reply
            .code(401)
            .send({ error: 'invalid_theme_preview_token' });
        }
        themeDraft = true;
      }
      const { taxonomySlug, termSlug } = parsed.data;
      const tenantId = await resolvePublicTenantId();

      const loader = async (): Promise<ArchiveViewPayload> => {
          // Term + owning taxonomy in one join — same lookup the public
          // taxonomy-terms endpoint does. Absent term ⇒ kebab fallback.
          const [term] = await db
            .select({
              name: schema.taxonomyTerms.name,
              description: schema.taxonomyTerms.description,
              taxonomyDescription: schema.taxonomies.description,
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

          const fallbackTitle = kebabToTitle(termSlug);
          const title = term?.name ?? fallbackTitle;
          // Byte-identical to the fallbacks the views derived client-side
          // (also applies when the term exists but has no description).
          const description =
            term?.description ??
            (taxonomySlug === 'tags'
              ? `Stories tagged ${fallbackTitle}.`
              : `Articles in ${fallbackTitle}.`);

          const resolved = resolveTemplate({ role: 'archive', taxonomySlug });
          // THEME OVERRIDE (v2.0): draft (theme_preview) → published → code
          // default. Pagination params come off the RESOLVED tree so an
          // override's loop count drives the shell's load-more too.
          const { instances } = await resolveThemeBlocks(
            request.log,
            tenantId,
            resolved.template,
            { draft: themeDraft },
          );
          const { contentType, pageSize } = findLoopParams(instances);

          // Full published count for the term — drives the tag hero's
          // "N Stories" and the shell's load-more/empty states. Identical
          // visibility + term filters to what the query-loop's fetchArchive
          // applies, so the count can never disagree with the grid.
          const [countRow] = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(schema.content)
            .innerJoin(
              schema.contentTypes,
              eq(schema.content.contentTypeId, schema.contentTypes.id),
            )
            .where(
              and(
                eq(schema.content.tenantId, tenantId),
                eq(schema.contentTypes.slug, contentType),
                PUBLISHED_VISIBILITY(),
                termExistsFilter(termSlug, taxonomySlug),
              ),
            );
          const total = countRow?.total ?? 0;

          const archive: ArchiveContext = {
            title,
            termSlug,
            taxonomySlug,
            description,
            taxonomyDescription: term?.taxonomyDescription ?? null,
            total,
          };

          const blockCtx = {
            ...buildBlockContext({ tenantId, locale: 'en' }),
            archive,
          };
          const blocks = await composeBlocks(blockCtx, instances, request.log);

          return {
            archive: {
              title,
              termSlug,
              taxonomySlug,
              description,
              taxonomyDescription: term?.taxonomyDescription ?? null,
              total,
            },
            blocks,
            pagination: {
              page: 1,
              pageSize,
              total,
              totalPages: Math.ceil(total / pageSize),
            },
          };
      };

      // Theme-draft previews bypass the cache (and are never stored) so the
      // editor's iframe always sees the latest draft and a draft render can
      // never poison the published cache entry.
      const payload = themeDraft
        ? await loader()
        : await withCache<ArchiveViewPayload>(
            `cache:view:archive:${tenantId}:${taxonomySlug}:${termSlug}`,
            PUBLIC_CACHE_TTL_SECONDS,
            loader,
          );

      if (themeDraft) {
        reply.header('Cache-Control', 'no-store, must-revalidate');
      } else {
        cacheHeaders(reply);
      }
      return { data: payload };
    },
  );

  // GET /api/public/views/system/:role  (theme engine v2 Phase 4)
  //
  // Composes the override-backed template for a system page (search/404/
  // authors/contact) and returns just its block tree. Same override precedence
  // + ?theme_preview handling + cache strategy as the archive view above. The
  // page-specific behaviour (search query, contact submit, author fetch) is in
  // the block components, so there's no per-request data to assemble here.
  fastify.get(
    '/system/:role',
    {
      schema: {
        tags: ['Views'],
        summary: 'Composed system-page view (404/search/authors/contact)',
        description:
          'Resolves the role template, applies the theme override (draft via theme_preview → published → code default), and returns the composed block tree. Cached for 5 minutes; theme-preview drafts bypass the cache.',
        operationId: 'getSystemView',
        response: {
          200: {
            description: 'Composed system-page payload',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  role: { type: 'string' },
                  blocks: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
                  },
                },
                required: ['role', 'blocks'],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Invalid query',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          401: {
            description: 'Invalid theme-preview token',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          404: {
            description: 'Unknown system role',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = SystemParams.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(404).send({ error: 'unknown_system_role' });
      }
      const queryParsed = Query.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'invalid query' });
      }
      let themeDraft = false;
      if (queryParsed.data.theme_preview) {
        if (!verifyThemePreviewToken(queryParsed.data.theme_preview)) {
          return reply.code(401).send({ error: 'invalid_theme_preview_token' });
        }
        themeDraft = true;
      }
      const { role } = parsed.data;
      const tenantId = await resolvePublicTenantId();

      const loader = async (): Promise<SystemViewPayload> => {
        const resolved = resolveTemplate({ role });
        const { instances } = await resolveThemeBlocks(
          request.log,
          tenantId,
          resolved.template,
          { draft: themeDraft },
        );
        const blockCtx = buildBlockContext({ tenantId, locale: 'en' });
        const blocks = await composeBlocks(blockCtx, instances, request.log);
        return { role, blocks };
      };

      const payload = themeDraft
        ? await loader()
        : await withCache<SystemViewPayload>(
            `cache:view:system:${tenantId}:${role}`,
            PUBLIC_CACHE_TTL_SECONDS,
            loader,
          );

      if (themeDraft) {
        reply.header('Cache-Control', 'no-store, must-revalidate');
      } else {
        cacheHeaders(reply);
      }
      return { data: payload };
    },
  );
};
