import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { listTemplatesForTheme, templateRegistry } from '@cms/blocks';
import { env } from '@cms/config';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { hasMinAdminRole, requireAdminRole } from '../../middleware/require-role.js';
import { logAudit } from '../../lib/audit.js';

// Admin Page Templates — merged read endpoint + user-save CRUD.
//
// Code-shipped templates live in packages/blocks/src/templates/* and are
// available to every tenant. User-saved templates live in the page_templates
// DB table, are tenant-scoped, and are authored from the dynamic page builder
// canvas. GET merges both into a single payload tagged with `source`.
//
// Filter rule (enforced HERE, not on the client): any template whose blockKeys
// array is empty is dropped from the response. The 0-block static-textpage
// code template would otherwise render as a meaningless picker entry in the
// dynamic builder. The filter is unconditional — there is no query-param
// escape hatch — so every caller sees the same list and a future caller can't
// accidentally regress this by skipping a UI-side filter.

const CreateTemplateBody = z
  .object({
    name: z.string().min(1).max(200).trim(),
    description: z.string().max(1000).optional(),
    blockKeys: z.array(z.string().min(1)).min(1, 'At least one block required'),
  })
  .strict();

const TEMPLATE_KEY_RE = /^[a-z0-9][a-z0-9-]*$/;

function slugifyTemplateName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base.slice(0, 80) : 'template';
}

export const adminPageTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // GET / — merged list (code + user). Empty-blockKeys rows ALWAYS dropped.
  fastify.get('/', async (request, reply) => {
    const session = request.adminSession!;
    const tenantId = session.user.tenantId;
    if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

    // Code-shipped templates first (scoped to the active theme's manifest —
    // a 'basic'/'core' install hides Decode-only templates like home-decode).
    const codeRows = listTemplatesForTheme(env.ACTIVE_THEME).map((t) => ({
      source: 'code' as const,
      id: null as string | null,
      key: t.key,
      name: t.name,
      description: t.description ?? null,
      blockKeys: t.blocks.map((b) => b.block_key),
      authorId: null as string | null,
      createdAt: null as string | null,
      updatedAt: null as string | null,
    }));

    const userRows = await db
      .select()
      .from(schema.pageTemplates)
      .where(
        and(
          tenantFilter(session.user, schema.pageTemplates.tenantId),
          isNull(schema.pageTemplates.deletedAt),
        ),
      )
      .orderBy(desc(schema.pageTemplates.updatedAt));

    const userMapped = userRows.map((r) => ({
      source: 'user' as const,
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      blockKeys: Array.isArray(r.blockKeys)
        ? (r.blockKeys as string[]).filter((k) => typeof k === 'string')
        : [],
      authorId: r.authorId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    // 0-block templates would render as a meaningless picker entry; grandfather
    // static-textpage out HERE so no future UI caller can bypass the filter.
    const merged = [...codeRows, ...userMapped].filter(
      (t) => t.blockKeys.length > 0,
    );
    return { data: merged };
  });

  // POST / — create a user template. Slug from name; suffix `-user-N` on
  // collision with a code key OR a sibling user row. Mirrors the duplicate
  // probe pattern in admin/pages.ts.
  fastify.post(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
    const body = CreateTemplateBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'Invalid body',
        issues: body.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const session = request.adminSession!;
    const tenantId = session.user.tenantId;
    if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

    // Find a free key. Probe up to 100 to dodge pathological collisions.
    const baseKey = slugifyTemplateName(body.data.name);
    let candidate: string;
    let assigned: string | null = null;
    for (let n = 0; n <= 100; n++) {
      candidate = n === 0 ? baseKey : `${baseKey}-user-${n}`;
      if (!TEMPLATE_KEY_RE.test(candidate)) continue;
      if (templateRegistry.has(candidate)) continue;
      const [conflict] = await db
        .select({ id: schema.pageTemplates.id })
        .from(schema.pageTemplates)
        .where(
          and(
            tenantFilter(session.user, schema.pageTemplates.tenantId),
            eq(schema.pageTemplates.key, candidate),
            isNull(schema.pageTemplates.deletedAt),
          ),
        )
        .limit(1);
      if (!conflict) {
        assigned = candidate;
        break;
      }
    }
    if (!assigned) {
      return reply
        .code(409)
        .send({ error: 'Could not find a free template key' });
    }

    const [row] = await db
      .insert(schema.pageTemplates)
      .values({
        tenantId,
        key: assigned,
        name: body.data.name,
        description: body.data.description ?? null,
        blockKeys: body.data.blockKeys,
        authorId: session.user.id,
      })
      .returning();
    await logAudit({
      tenantId,
      actorId: session.user.id,
      action: 'page_template.created',
      resourceType: 'page_template',
      resourceId: row!.id,
      afterSnapshot: {
        key: row!.key,
        name: row!.name,
        blockCount: body.data.blockKeys.length,
      },
      request,
    });
    return reply.code(201).send({
      data: {
        source: 'user' as const,
        id: row!.id,
        key: row!.key,
        name: row!.name,
        description: row!.description,
        blockKeys: body.data.blockKeys,
        authorId: row!.authorId,
        createdAt: row!.createdAt.toISOString(),
        updatedAt: row!.updatedAt.toISOString(),
      },
    });
  });

  // DELETE /:id — soft delete. Only the author or a super_admin can remove a
  // template. Code-shipped templates aren't in the DB and so are never reachable
  // through this endpoint (404 by row absence).
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const [row] = await db
        .select()
        .from(schema.pageTemplates)
        .where(
          and(
            eq(schema.pageTemplates.id, request.params.id),
            tenantFilter(session.user, schema.pageTemplates.tenantId),
            isNull(schema.pageTemplates.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'Not found' });

      const isOwner = row.authorId === session.user.id;
      const isSuperAdmin = hasMinAdminRole(session.user.role, 'super_admin');
      if (!isOwner && !isSuperAdmin) {
        return reply.code(403).send({
          error: 'Only the author or a super_admin can delete this template',
        });
      }

      await db
        .update(schema.pageTemplates)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.pageTemplates.id, row.id));
      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'page_template.deleted',
        resourceType: 'page_template',
        resourceId: row.id,
        beforeSnapshot: { key: row.key, name: row.name },
        request,
      });
      return reply.code(204).send();
    },
  );
};
