import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';

const ResolveQuery = z.object({
  path: z.string().min(1).max(2048),
});

/**
 * Anonymous public redirect resolution. Given an incoming path, returns the
 * target + status code (the caller — Nuxt server middleware / edge — issues the
 * actual 301/302). Single-hop: to_path is returned as-is, never followed.
 */
export const publicRedirectsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/resolve',
    {
      schema: {
        tags: ['Redirects'],
        summary: 'Resolve a single-hop redirect for an incoming path',
        description:
          'Looks up an active redirect matching the given path and returns the target plus HTTP status (301 or 302). The caller (typically SSR middleware) issues the actual redirect response. Single-hop only — the target is never followed transitively. Returns 404 when no active redirect matches.',
        operationId: 'resolveRedirect',
        response: {
          200: {
            description: 'Active redirect resolved',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  toPath: {
                    type: 'string',
                    description:
                      'Target path. The caller issues the redirect — this endpoint never follows it.',
                  },
                  redirectType: {
                    type: 'integer',
                    enum: [301, 302],
                    description: 'HTTP status the caller should use',
                  },
                },
                required: ['toPath', 'redirectType'],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Missing or invalid `path` query parameter',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          404: {
            description: 'No active redirect matches the path',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
    const query = ResolveQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'Query param "path" is required' });
    }

    const tenantId = await resolvePublicTenantId();

    const [row] = await db
      .select({
        id: schema.redirects.id,
        toPath: schema.redirects.toPath,
        redirectType: schema.redirects.redirectType,
      })
      .from(schema.redirects)
      .where(
        and(
          eq(schema.redirects.tenantId, tenantId),
          eq(schema.redirects.fromPath, query.data.path),
          eq(schema.redirects.isActive, true),
        ),
      )
      .limit(1);

    if (!row) return reply.code(404).send({ error: 'No redirect' });

    // Fire-and-forget hit tracking — the stats write must never gate redirect
    // latency, and a failed counter must never fail a valid resolution.
    void db
      .update(schema.redirects)
      .set({
        hitCount: sql`${schema.redirects.hitCount} + 1`,
        lastHitAt: new Date(),
      })
      .where(eq(schema.redirects.id, row.id))
      .catch((err: unknown) => {
        request.log.warn(
          { err, redirectId: row.id },
          'failed to update redirects.hit_count',
        );
      });

    return { data: { toPath: row.toPath, redirectType: row.redirectType } };
  });
};
