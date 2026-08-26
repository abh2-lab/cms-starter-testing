import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { objectUrl } from '../../lib/s3.js';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';

/**
 * Anonymous public site configuration — what the frontend needs to render the
 * site shell, SEO defaults, analytics, and decide maintenance mode. Image keys
 * are resolved to display URLs here; the DB never stores URLs. Internal fields
 * (contactEmail, ids, timestamps) are deliberately omitted; the `extra` jsonb
 * is surfaced for per-tenant unstructured config (ticker headlines, impact
 * stats, etc.).
 */
export const publicSiteSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['Site'],
        summary: 'Get global site settings',
        description:
          'Returns site name, URL, logos (resolved to display URLs), default SEO/robots/analytics settings, and feature toggles like maintenance mode. Internal fields (contact email, ids, timestamps) are omitted. Cached for 5 minutes.',
        operationId: 'getSiteSettings',
        response: {
          200: {
            description:
              'Site settings, or `{ data: null }` when no settings row exists for the tenant',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                nullable: true,
                properties: {
                  siteName: { type: 'string' },
                  siteUrl: { type: 'string' },
                  siteDescription: { type: 'string', nullable: true },
                  logoUrl: {
                    type: 'string',
                    nullable: true,
                    description: 'Resolved display URL for the site logo',
                  },
                  faviconUrl: { type: 'string', nullable: true },
                  ogImageUrl: { type: 'string', nullable: true },
                  socialLinks: {
                    type: 'object',
                    nullable: true,
                    additionalProperties: true,
                  },
                  defaultMetaTitleSuffix: { type: 'string', nullable: true },
                  defaultRobots: { type: 'string' },
                  googleSiteVerification: { type: 'string', nullable: true },
                  analyticsId: { type: 'string', nullable: true },
                  commentsEnabled: { type: 'boolean' },
                  registrationEnabled: { type: 'boolean' },
                  maintenanceMode: { type: 'boolean' },
                  customHeadScripts: { type: 'string', nullable: true },
                  customBodyScripts: { type: 'string', nullable: true },
                  extra: {
                    type: 'object',
                    nullable: true,
                    additionalProperties: true,
                    description:
                      'Per-tenant unstructured config (ticker headlines, impact stats, tagline, footer coordinates, etc.). Shape is project-specific.',
                  },
                },
              },
            },
            required: ['data'],
          },
        },
      },
    },
    async (_request, reply) => {
    const tenantId = await resolvePublicTenantId();

    const payload = await withCache(
      `cache:site-settings:${tenantId}`,
      PUBLIC_CACHE_TTL_SECONDS,
      async () => {
        const [row] = await db
          .select()
          .from(schema.siteSettings)
          .where(eq(schema.siteSettings.tenantId, tenantId))
          .limit(1);

        if (!row) return { data: null };

        const [logoUrl, faviconUrl, ogImageUrl] = await Promise.all([
          row.logoKey ? objectUrl(row.logoKey) : Promise.resolve(null),
          row.faviconKey ? objectUrl(row.faviconKey) : Promise.resolve(null),
          row.defaultOgImageKey
            ? objectUrl(row.defaultOgImageKey)
            : Promise.resolve(null),
        ]);

        return {
          data: {
            siteName: row.siteName,
            siteUrl: row.siteUrl,
            siteDescription: row.siteDescription,
            logoUrl,
            faviconUrl,
            ogImageUrl,
            socialLinks: row.socialLinks,
            defaultMetaTitleSuffix: row.defaultMetaTitleSuffix,
            defaultRobots: row.defaultRobots,
            googleSiteVerification: row.googleSiteVerification,
            analyticsId: row.analyticsId,
            commentsEnabled: row.commentsEnabled,
            registrationEnabled: row.registrationEnabled,
            maintenanceMode: row.maintenanceMode,
            customHeadScripts: row.customHeadScripts,
            customBodyScripts: row.customBodyScripts,
            extra: row.extra,
          },
        };
      },
    );

    cacheHeaders(reply);
    return payload;
  });
};
