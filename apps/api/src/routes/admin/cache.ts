import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { logAudit } from '../../lib/audit.js';
import {
  CACHE_NAMESPACES,
  purgeTenantCache,
  purgeContentTypeCache,
} from '../../lib/purge-tenant-cache.js';
import {
  purgeWebCache,
  type WebPurgeResult,
} from '../../lib/purge-web-cache.js';

// Which slice of cache to drop. Discriminated union so the content-type case
// carries its slug and the other two don't. The slug regex matches the content
// type SlugSchema in content-types.ts (lowercase, hyphenated, letter-leading)
// so a crafted body can't inject glob metacharacters into the SCAN pattern.
const PurgeBodySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all') }),
  z.object({ scope: z.literal('web') }),
  z.object({
    scope: z.literal('content-type'),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9-]*$/, 'invalid content type slug'),
  }),
]);

export const adminCacheRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // POST /purge — clear cached copies on demand (Tools → Purge Cache).
  //
  // super_admin only: this sits alongside the Settings pages, which are all
  // super_admin-gated, and a full purge briefly slows the whole site as caches
  // rebuild. No data is ever deleted — only the fast copies — and the whole
  // thing is fail-open (the reused helpers swallow their own Redis/web errors),
  // so a purge can never 500 on a transient Dragonfly or web-container blip.
  //
  // The response echoes the web-purge outcome (`web`) so the admin UI can warn
  // when the website page cache silently didn't clear (the common production
  // cause of "my change still isn't visible") instead of a false success.
  fastify.post(
    '/purge',
    { preHandler: requireAdminRole('super_admin') },
    async (request, reply) => {
      const session = request.adminSession;
      if (!session) {
        // Unreachable after requireAdminAuth, but narrows the type for TS.
        return reply.code(401).send({ error: 'Unauthenticated' });
      }

      const parsed = PurgeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid request', issues: parsed.error.issues });
      }

      const tenantId = session.user.tenantId;
      if (!tenantId) {
        // A global/system super_admin (tenantId null) has no single site whose
        // cache to clear. Fail loudly rather than silently purging nothing.
        return reply
          .code(400)
          .send({ error: 'No tenant in session; cache purge is per-site.' });
      }

      const body = parsed.data;
      let purgedNamespaces: readonly string[] = [];
      let web: WebPurgeResult;
      if (body.scope === 'all') {
        web = await purgeTenantCache(request.log, tenantId);
        purgedNamespaces = CACHE_NAMESPACES;
      } else if (body.scope === 'content-type') {
        web = await purgeContentTypeCache(request.log, tenantId, body.slug);
        purgedNamespaces = ['content', 'archive'];
      } else {
        // scope === 'web' — drop only the Nitro SWR HTML + embed cards.
        web = await purgeWebCache(request.log, tenantId);
      }

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'cache.purged',
        resourceType: 'cache',
        resourceId: null,
        metadata: {
          scope: body.scope,
          webOk: web.ok,
          ...(web.ok ? {} : { webReason: web.reason }),
          ...(body.scope === 'content-type' ? { slug: body.slug } : {}),
        },
        request,
      });

      return reply.send({
        data: { scope: body.scope, purgedNamespaces, web },
      });
    },
  );
};
