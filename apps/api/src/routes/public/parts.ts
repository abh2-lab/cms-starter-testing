import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPart } from '@cms/blocks';
import {
  composeBlocks,
  type ComposedBlock,
} from '../../lib/compose-blocks.js';
import { resolveThemeBlocks } from '../../lib/theme-overrides.js';
import { verifyThemePreviewToken } from '../../lib/preview-token.js';
import { buildBlockContext } from '../../lib/block-context.js';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';

// GET /api/public/parts/:key
//
// Composed template-PART (theme engine v1.5): header / footer / sidebar —
// named reusable block-lists the layout and view shells mount around the
// per-route content (see partRegistry in @cms/blocks). Composed with neither
// a box nor an archive context: part blocks are self-sufficient (the site-nav
// and footer blocks fetch their menus/settings renderer-side, so this payload
// is structure-only and stays valid when menus change).

const Params = z.object({
  key: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z][a-z0-9-]*$/),
});

const Query = z.object({
  // Theme-preview token (structure-editor drafts, theme engine v2.0) — makes
  // part resolution see DRAFT overrides and bypasses the cache.
  theme_preview: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .optional(),
});

interface PartPayload {
  key: string;
  blocks: ComposedBlock[];
}

export const publicPartsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:key',
    {
      schema: {
        tags: ['Views'],
        summary: 'Composed template-part by key',
        description:
          'Returns the composed block tree for a named template part (header, footer, …). 404 when the part key is unknown. Cached for 5 minutes.',
        operationId: 'getPart',
        response: {
          200: {
            description: 'Composed part payload',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  // Composed tree — open objects so the machine-generated
                  // ComposedBlock shape passes verbatim (same escape hatch as
                  // the content route's blocks).
                  blocks: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
                  },
                },
                required: ['key', 'blocks'],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Invalid part key',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          401: {
            description: 'Invalid theme-preview token',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          404: {
            description: 'Unknown part key',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = Params.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid part key' });
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
      const { key } = parsed.data;

      const part = getPart(key);
      if (!part) {
        return reply.code(404).send({ error: 'unknown part' });
      }

      const tenantId = await resolvePublicTenantId();

      const loader = async (): Promise<PartPayload> => {
        const ctx = buildBlockContext({ tenantId, locale: 'en' });
        // THEME OVERRIDE (v2.0): draft (theme_preview) → published → code
        // default. codePrefix keeps the deterministic part id namespace for
        // un-overridden parts.
        const { instances } = await resolveThemeBlocks(
          request.log,
          tenantId,
          part,
          { draft: themeDraft, codePrefix: `part-${key}` },
        );
        const blocks = await composeBlocks(ctx, instances, request.log);
        return { key, blocks };
      };

      // Theme-draft previews bypass the cache (and are never stored).
      const payload = themeDraft
        ? await loader()
        : await withCache<PartPayload>(
            `cache:part:${tenantId}:${key}`,
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
