import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { invalidatePattern } from '../../lib/cache.js';
import { purgeWebCache } from '../../lib/purge-web-cache.js';

// ─── Validation schemas ────────────────────────────────────────────────────

const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9-]*$/, 'must be lowercase alphanumeric + hyphens');

const CreateMenuBody = z.object({
  name: z.string().min(1).max(100),
  slug: SlugSchema,
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional().default(true),
});
const UpdateMenuBody = CreateMenuBody.partial();

const CreateItemBody = z.object({
  label: z.string().min(1).max(200),
  url: z.string().max(2048).nullable().optional(),
  contentId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  openInNewTab: z.boolean().optional().default(false),
  icon: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});
const UpdateItemBody = CreateItemBody.partial();

const ReorderBody = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      sortOrder: z.number().int(),
      parentId: z.string().uuid().nullable(),
    }),
  ),
});

const MenuIdParam = z.object({ id: z.string().uuid() });
const MenuScopeParam = z.object({ menuId: z.string().uuid() });
const ItemScopeParam = z.object({
  menuId: z.string().uuid(),
  itemId: z.string().uuid(),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// Tenant filter moved to ../../lib/tenant-scope.ts (tenantFilter) so
// super_admin bypasses scoping automatically.

function isMenuSlugConflict(e: unknown): boolean {
  return e instanceof Error && e.message.includes('menus_tenant_slug_uniq');
}

function sendZodError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: 'Invalid request body',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  });
}

async function assertMenuInTenant(
  menuId: string,
  session: { role: string; tenantId: string | null },
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.menus.id })
    .from(schema.menus)
    .where(
      and(eq(schema.menus.id, menuId), tenantFilter(session, schema.menus.tenantId)),
    )
    .limit(1);
  return Boolean(row);
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const adminMenusRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // Bust the public menu cache after any successful mutation so editor changes
  // appear on the live site immediately instead of waiting out the 5-minute
  // TTL. Menu writes are rare, so clearing the whole menu namespace (rather
  // than computing the exact tenant key — awkward for super_admin whose
  // session tenantId is null) is cheap and always correct.
  fastify.addHook('onResponse', async (request, reply) => {
    const method = request.method;
    const mutating =
      method === 'POST' ||
      method === 'PATCH' ||
      method === 'PUT' ||
      method === 'DELETE';
    if (mutating && reply.statusCode >= 200 && reply.statusCode < 300) {
      await invalidatePattern('cache:menu:*');
      // Also drop the web (Nitro SWR) HTML cache — the nav renders into the
      // cached home/stories/archive pages, so a Redis-only drop leaves the old
      // menu on those pages for up to the 5-min TTL. Fail-open.
      await purgeWebCache(request.log, request.adminSession?.user.tenantId ?? null);
    }
  });

  fastify.get('/', async (request) => {
    const session = getSession(request);
    const rows = await db
      .select()
      .from(schema.menus)
      .where(tenantFilter(session.user, schema.menus.tenantId))
      .orderBy(schema.menus.name);
    return { data: rows };
  });

  // Menu + its items.
  fastify.get('/:id', async (request, reply) => {
    const params = MenuIdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
    const session = getSession(request);
    const [menu] = await db
      .select()
      .from(schema.menus)
      .where(
        and(
          eq(schema.menus.id, params.data.id),
          tenantFilter(session.user, schema.menus.tenantId),
        ),
      )
      .limit(1);
    if (!menu) return reply.code(404).send({ error: 'Not found' });
    const items = await db
      .select()
      .from(schema.menuItems)
      .where(eq(schema.menuItems.menuId, menu.id))
      .orderBy(schema.menuItems.sortOrder);
    return { data: { ...menu, items } };
  });

  fastify.post(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const parsed = CreateMenuBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const session = getSession(request);
      try {
        const [row] = await db
          .insert(schema.menus)
          .values({ ...parsed.data, tenantId: session.user.tenantId })
          .returning();
        return reply.code(201).send({ data: row });
      } catch (e: unknown) {
        if (isMenuSlugConflict(e)) {
          return reply
            .code(409)
            .send({ error: 'A menu with this slug already exists' });
        }
        throw e;
      }
    },
  );

  fastify.patch(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = MenuIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const body = UpdateMenuBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      if (Object.keys(body.data).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }
      const session = getSession(request);
      try {
        const [row] = await db
          .update(schema.menus)
          .set({ ...body.data, updatedAt: sql`now()` })
          .where(
            and(
              eq(schema.menus.id, params.data.id),
              tenantFilter(session.user, schema.menus.tenantId),
            ),
          )
          .returning();
        if (!row) return reply.code(404).send({ error: 'Not found' });
        return { data: row };
      } catch (e: unknown) {
        if (isMenuSlugConflict(e)) {
          return reply
            .code(409)
            .send({ error: 'A menu with this slug already exists' });
        }
        throw e;
      }
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = MenuIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const session = getSession(request);
      const [deleted] = await db
        .delete(schema.menus)
        .where(
          and(
            eq(schema.menus.id, params.data.id),
            tenantFilter(session.user, schema.menus.tenantId),
          ),
        )
        .returning({ id: schema.menus.id });
      if (!deleted) return reply.code(404).send({ error: 'Not found' });
      return reply.code(204).send();
    },
  );

  // ─── Items ──────────────────────────────────────────────────────────────

  fastify.post(
    '/:menuId/items',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = MenuScopeParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid menuId' });
      }
      const body = CreateItemBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      const session = getSession(request);
      if (!(await assertMenuInTenant(params.data.menuId, session.user))) {
        return reply.code(404).send({ error: 'Menu not found' });
      }
      const [row] = await db
        .insert(schema.menuItems)
        .values({
          ...body.data,
          menuId: params.data.menuId,
          tenantId: session.user.tenantId,
        })
        .returning();
      return reply.code(201).send({ data: row });
    },
  );

  fastify.patch(
    '/:menuId/items/:itemId',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = ItemScopeParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id(s)' });
      const body = UpdateItemBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      if (Object.keys(body.data).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }
      const session = getSession(request);
      if (!(await assertMenuInTenant(params.data.menuId, session.user))) {
        return reply.code(404).send({ error: 'Menu not found' });
      }
      const [row] = await db
        .update(schema.menuItems)
        .set({ ...body.data, updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.menuItems.id, params.data.itemId),
            eq(schema.menuItems.menuId, params.data.menuId),
          ),
        )
        .returning();
      if (!row) return reply.code(404).send({ error: 'Not found' });
      return { data: row };
    },
  );

  fastify.delete(
    '/:menuId/items/:itemId',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = ItemScopeParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id(s)' });
      const session = getSession(request);
      if (!(await assertMenuInTenant(params.data.menuId, session.user))) {
        return reply.code(404).send({ error: 'Menu not found' });
      }
      const [deleted] = await db
        .delete(schema.menuItems)
        .where(
          and(
            eq(schema.menuItems.id, params.data.itemId),
            eq(schema.menuItems.menuId, params.data.menuId),
          ),
        )
        .returning({ id: schema.menuItems.id });
      if (!deleted) return reply.code(404).send({ error: 'Not found' });
      return reply.code(204).send();
    },
  );

  // Bulk reorder / re-parent — applied in one transaction.
  fastify.put(
    '/:menuId/items/order',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = MenuScopeParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid menuId' });
      }
      const body = ReorderBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      const session = getSession(request);
      if (!(await assertMenuInTenant(params.data.menuId, session.user))) {
        return reply.code(404).send({ error: 'Menu not found' });
      }
      await db.transaction(async (tx) => {
        for (const item of body.data.items) {
          await tx
            .update(schema.menuItems)
            .set({
              sortOrder: item.sortOrder,
              parentId: item.parentId,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(schema.menuItems.id, item.id),
                eq(schema.menuItems.menuId, params.data.menuId),
              ),
            );
        }
      });
      return { data: { ok: true } };
    },
  );
};
