import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { WEBHOOK_EVENTS } from '@cms/types';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import {
  generateMarkdown,
  loadDocsData,
  slugifySiteName,
  type SectionsResponse,
} from '../../services/docs-generator/index.js';

// ─── Validation ────────────────────────────────────────────────────────────

const SectionFlag = z.object({ include: z.boolean() });

const ContentSectionSchema = z.object({
  include: z.boolean(),
  // Cap the array so a malformed client can't request a huge SELECT IN list.
  // 200 is well above the realistic number of content types per tenant.
  contentTypeIds: z.array(z.string().uuid()).max(200).default([]),
});

const GenerateBody = z.object({
  mode: z.enum(['readable', 'compact']),
  sections: z.object({
    content: ContentSectionSchema,
    taxonomy: SectionFlag,
    menus: SectionFlag,
    settings: SectionFlag,
    webhooks: SectionFlag,
    search: SectionFlag,
    submissions: SectionFlag,
  }),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    // Programming error — every route below has requireAdminAuth preHandler.
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const adminDocsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);
  fastify.addHook('preHandler', requireAdminRole('super_admin'));

  // GET /sections — selector data for the admin UI.
  fastify.get('/sections', async (request) => {
    const session = getSession(request);
    const tenantWhereSettings = tenantFilter(session.user, schema.siteSettings.tenantId);
    const tenantWhereContentTypes = tenantFilter(session.user, schema.contentTypes.tenantId);
    const tenantWhereMenus = tenantFilter(session.user, schema.menus.tenantId);

    const [settingsRow, contentTypes, menus] = await Promise.all([
      db
        .select({
          siteName: schema.siteSettings.siteName,
          siteUrl: schema.siteSettings.siteUrl,
        })
        .from(schema.siteSettings)
        .where(tenantWhereSettings)
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          id: schema.contentTypes.id,
          slug: schema.contentTypes.slug,
          name: schema.contentTypes.name,
          description: schema.contentTypes.description,
          submissionAccess: schema.contentTypes.submissionAccess,
        })
        .from(schema.contentTypes)
        .where(tenantWhereContentTypes)
        .orderBy(asc(schema.contentTypes.name)),
      db
        .select({
          slug: schema.menus.slug,
          name: schema.menus.name,
        })
        .from(schema.menus)
        .where(and(tenantWhereMenus, eq(schema.menus.isActive, true)))
        .orderBy(asc(schema.menus.name)),
    ]);

    const response: SectionsResponse = {
      siteName: settingsRow?.siteName ?? '',
      siteUrl: settingsRow?.siteUrl ?? '',
      contentTypes,
      menus,
      hasSubmissionsEnabled: contentTypes.some(
        (t) => t.submissionAccess !== 'none',
      ),
      webhookEvents: [...WEBHOOK_EVENTS],
    };
    return { data: response };
  });

  // POST /generate — build a .md document from the supplied selection.
  fastify.post('/generate', async (request, reply) => {
    const parsed = GenerateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const session = getSession(request);
    const data = await loadDocsData(session.user.tenantId, parsed.data);
    const markdown = generateMarkdown(parsed.data, data, parsed.data.mode);
    const filename = `${slugifySiteName(data.siteName)}-api-reference.md`;
    return { data: { markdown, filename } };
  });
};
