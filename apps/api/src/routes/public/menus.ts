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

const Params = z.object({
  location: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
});

interface MenuItemNode {
  id: string;
  label: string;
  url: string | null;
  contentSlug: string | null;
  contentType: string | null;
  openInNewTab: boolean;
  sortOrder: number;
  children: MenuItemNode[];
}

interface MenuPayload {
  id: string;
  name: string;
  slug: string;
  items: MenuItemNode[];
}

// Cycle guard: drop any item whose parent chain exceeds this depth.
const MAX_DEPTH = 10;

/**
 * Anonymous public menu fetch. Resolves a menu by its slug (location) and
 * returns the active item tree. Items pointing at content carry the resolved
 * content slug + type so the frontend can build URLs without an extra round
 * trip.
 */
export const publicMenusRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:location',
    {
      schema: {
        tags: ['Menus'],
        summary: 'Fetch a navigation menu by location',
        description:
          'Returns the active menu tree at the given slug (for example main-menu or footer-menu). Items linking to content rows are hydrated with the resolved slug and content type so the frontend can build URLs without a second round trip. Tree depth is capped at 10 to guard against accidental parent cycles. Returns 404 if no active menu matches. Cached for 5 minutes.',
        operationId: 'getMenuByLocation',
        response: {
          200: {
            description: 'Active menu with its item tree',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  items: {
                    type: 'array',
                    items: { $ref: 'MenuItemNode#' },
                  },
                },
                required: ['id', 'name', 'slug', 'items'],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Invalid location slug',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          404: {
            description: 'No active menu matches the location',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
    const parsed = Params.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid location' });
    }
    const { location } = parsed.data;

    const tenantId = await resolvePublicTenantId();

    const payload = await withCache<MenuPayload | null>(
      `cache:menu:${tenantId}:${location}`,
      PUBLIC_CACHE_TTL_SECONDS,
      async () => {
        const [menu] = await db
          .select({
            id: schema.menus.id,
            name: schema.menus.name,
            slug: schema.menus.slug,
          })
          .from(schema.menus)
          .where(
            and(
              eq(schema.menus.tenantId, tenantId),
              eq(schema.menus.slug, location),
              eq(schema.menus.isActive, true),
            ),
          )
          .limit(1);

        if (!menu) return null;

        const rows = await db
          .select({
            id: schema.menuItems.id,
            label: schema.menuItems.label,
            url: schema.menuItems.url,
            openInNewTab: schema.menuItems.openInNewTab,
            parentId: schema.menuItems.parentId,
            sortOrder: schema.menuItems.sortOrder,
            contentSlug: schema.content.slug,
            contentType: schema.contentTypes.slug,
          })
          .from(schema.menuItems)
          .leftJoin(
            schema.content,
            eq(schema.menuItems.contentId, schema.content.id),
          )
          .leftJoin(
            schema.contentTypes,
            eq(schema.content.contentTypeId, schema.contentTypes.id),
          )
          .where(
            and(
              eq(schema.menuItems.menuId, menu.id),
              eq(schema.menuItems.isActive, true),
            ),
          );

        // Bucket items by parentId, sort each bucket by sortOrder, then walk
        // depth-first from the roots. The MAX_DEPTH cap guards against an
        // accidentally cyclic parent_id chain looping the build forever.
        type Row = (typeof rows)[number];
        const byParent = new Map<string | null, Row[]>();
        for (const row of rows) {
          const bucket = byParent.get(row.parentId);
          if (bucket) {
            bucket.push(row);
          } else {
            byParent.set(row.parentId, [row]);
          }
        }
        for (const bucket of byParent.values()) {
          bucket.sort((a, b) => a.sortOrder - b.sortOrder);
        }

        const build = (
          parentKey: string | null,
          depth: number,
        ): MenuItemNode[] => {
          if (depth >= MAX_DEPTH) {
            const lost = byParent.get(parentKey);
            if (lost && lost.length > 0) {
              fastify.log.warn(
                { menuSlug: location, depth },
                'menu items dropped at depth cap',
              );
            }
            return [];
          }
          const bucket = byParent.get(parentKey);
          if (!bucket) return [];
          return bucket.map((row) => ({
            id: row.id,
            label: row.label,
            url: row.url,
            openInNewTab: row.openInNewTab,
            contentSlug: row.contentSlug,
            contentType: row.contentType,
            sortOrder: row.sortOrder,
            children: build(row.id, depth + 1),
          }));
        };

        return {
          id: menu.id,
          name: menu.name,
          slug: menu.slug,
          items: build(null, 0),
        };
      },
    );

    if (!payload) return reply.code(404).send({ error: 'menu not found' });

    cacheHeaders(reply);
    return { data: payload };
  });
};
