import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { invalidateKeys } from '../../lib/cache.js';
import { purgeWebCache } from '../../lib/purge-web-cache.js';
import { objectUrl } from '../../lib/s3.js';
import { invalidateSiteUrlCache } from '../../lib/site-url.js';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

// z.string().url() accepts "http:localhost:3001" (no `//`) because the URL
// constructor parses it as a scheme + opaque path. That value then explodes
// downstream — `${siteUrl}/<slug>` becomes a relative-looking string the
// browser concatenates onto the admin's own origin. Require explicit `//`.
const httpUrl = z
  .string()
  .url()
  .max(2048)
  .refine((s) => /^https?:\/\//.test(s), {
    message: 'Must start with http:// or https:// (note the two slashes).',
  });

const PutBody = z.object({
  siteName: z.string().min(1).max(200),
  siteUrl: httpUrl,
  siteDescription: z.string().max(2000).nullable().optional(),
  logoKey: z.string().max(1024).nullable().optional(),
  faviconKey: z.string().max(1024).nullable().optional(),
  defaultOgImageKey: z.string().max(1024).nullable().optional(),
  contactEmail: z.string().max(320).nullable().optional(),
  socialLinks: z.record(z.string(), z.unknown()).nullable().optional(),
  defaultMetaTitleSuffix: z.string().max(200).nullable().optional(),
  defaultRobots: z.string().max(100).optional(),
  googleSiteVerification: z.string().max(200).nullable().optional(),
  analyticsId: z.string().max(100).nullable().optional(),
  commentsEnabled: z.boolean().optional(),
  registrationEnabled: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  customHeadScripts: z.string().nullable().optional(),
  customBodyScripts: z.string().nullable().optional(),
  extra: z.record(z.string(), z.unknown()).nullable().optional(),
});

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// Tenant filter moved to ../../lib/tenant-scope.ts (tenantFilter) so
// super_admin bypasses scoping automatically.

function sendZodError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: 'Invalid request body',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  });
}

export const adminSiteSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // GET / — the tenant's settings row, or null if not configured yet. Image
  // keys are additionally resolved to display URLs for the admin UI previews.
  fastify.get('/', async (request) => {
    const session = getSession(request);
    const [row] = await db
      .select()
      .from(schema.siteSettings)
      .where(tenantFilter(session.user, schema.siteSettings.tenantId))
      .limit(1);
    if (!row) return { data: null };
    const [logoUrl, faviconUrl, ogImageUrl] = await Promise.all([
      row.logoKey ? objectUrl(row.logoKey) : Promise.resolve(null),
      row.faviconKey ? objectUrl(row.faviconKey) : Promise.resolve(null),
      row.defaultOgImageKey
        ? objectUrl(row.defaultOgImageKey)
        : Promise.resolve(null),
    ]);
    return { data: { ...row, logoUrl, faviconUrl, ogImageUrl } };
  });

  // PUT / — upsert the single settings row for the tenant (admin+).
  fastify.put(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const parsed = PutBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const session = getSession(request);

      const [existing] = await db
        .select({ id: schema.siteSettings.id })
        .from(schema.siteSettings)
        .where(tenantFilter(session.user, schema.siteSettings.tenantId))
        .limit(1);

      if (existing) {
        const [row] = await db
          .update(schema.siteSettings)
          .set({ ...parsed.data, updatedAt: sql`now()` })
          .where(eq(schema.siteSettings.id, existing.id))
          .returning();
        // siteUrl may have changed — invalidate so the next /auth/me and
        // Preview-button call reads the new value.
        invalidateSiteUrlCache(session.user.tenantId);
        // Evict the public site-settings cache so maintenanceMode (and any
        // other field the public route surfaces) propagates within seconds
        // instead of waiting out the 5-minute TTL.
        await invalidateKeys([
          `cache:site-settings:${session.user.tenantId}`,
        ]);
        // Also drop the web (Nitro SWR) HTML cache — the logo, tagline and
        // ticker headlines from site settings render into the cached home
        // page, so a Redis-only drop leaves it stale for the 5-min TTL.
        await purgeWebCache(request.log, session.user.tenantId);
        return { data: row };
      }

      const [row] = await db
        .insert(schema.siteSettings)
        .values({ ...parsed.data, tenantId: session.user.tenantId })
        .returning();
      invalidateSiteUrlCache(session.user.tenantId);
      await invalidateKeys([`cache:site-settings:${session.user.tenantId}`]);
      await purgeWebCache(request.log, session.user.tenantId);
      return reply.code(201).send({ data: row });
    },
  );
};
