import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, ilike, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { hashPassword } from '../../services/password.js';

const RoleSchema = z.enum([
  'super_admin',
  'admin',
  'editor',
  'author',
  'viewer',
]);

const CreateBody = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(200),
  role: RoleSchema,
});
const UpdateBody = z.object({
  displayName: z.string().min(1).max(200).optional(),
  role: RoleSchema.optional(),
  isActive: z.boolean().optional(),
});
const IdParam = z.object({ id: z.string().uuid() });

const ListQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().min(1).max(320).optional(),
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

function isEmailConflict(e: unknown): boolean {
  return e instanceof Error && e.message.includes('admin_users_email');
}

// Never return hashed_password. isProtected is included so the UI can
// render delete/role controls as disabled for the bootstrap super admin.
const publicColumns = {
  id: schema.adminUsers.id,
  email: schema.adminUsers.email,
  displayName: schema.adminUsers.displayName,
  role: schema.adminUsers.role,
  isActive: schema.adminUsers.isActive,
  isProtected: schema.adminUsers.isProtected,
  avatarUrl: schema.adminUsers.avatarUrl,
  lastLoginAt: schema.adminUsers.lastLoginAt,
  emailVerifiedAt: schema.adminUsers.emailVerifiedAt,
  createdAt: schema.adminUsers.createdAt,
  updatedAt: schema.adminUsers.updatedAt,
};

function generateTempPassword(): string {
  return randomBytes(12).toString('base64url');
}

export const adminUsersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);
  // All user management is super_admin-only.
  fastify.addHook('preHandler', requireAdminRole('super_admin'));

  fastify.get('/', async (request, reply) => {
    const query = ListQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        error: 'Invalid query',
        issues: query.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const session = getSession(request);
    const conditions: (SQL | undefined)[] = [tenantFilter(session.user, schema.adminUsers.tenantId)];
    if (query.data.q) {
      conditions.push(ilike(schema.adminUsers.email, `%${query.data.q}%`));
    }
    if (query.data.cursor) {
      conditions.push(lt(schema.adminUsers.id, query.data.cursor));
    }
    const rows = await db
      .select(publicColumns)
      .from(schema.adminUsers)
      .where(and(...conditions))
      .orderBy(desc(schema.adminUsers.id))
      .limit(query.data.limit + 1);
    const hasMore = rows.length > query.data.limit;
    const data = hasMore ? rows.slice(0, query.data.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.id : null;
    return {
      data,
      pagination: { nextCursor, hasMore, limit: query.data.limit },
    };
  });

  // Create a user with a generated temporary password, returned once. A proper
  // email-based invite with a setup token is a later addition (needs schema).
  fastify.post('/', async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body);
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
    const tempPassword = generateTempPassword();
    try {
      const [row] = await db
        .insert(schema.adminUsers)
        .values({
          tenantId: session.user.tenantId,
          email: parsed.data.email,
          displayName: parsed.data.displayName,
          role: parsed.data.role,
          hashedPassword: await hashPassword(tempPassword),
        })
        .returning(publicColumns);
      request.log.info(
        { email: parsed.data.email },
        'admin user created (temp password issued)',
      );
      return reply.code(201).send({ data: { ...row, tempPassword } });
    } catch (e: unknown) {
      if (isEmailConflict(e)) {
        return reply
          .code(409)
          .send({ error: 'An account with this email already exists' });
      }
      throw e;
    }
  });

  fastify.patch('/:id', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
    const body = UpdateBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request body' });
    }
    if (Object.keys(body.data).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    const session = getSession(request);
    // Guard against self-lockout: can't change your own role / active status.
    if (
      params.data.id === session.user.id &&
      (body.data.role !== undefined || body.data.isActive !== undefined)
    ) {
      return reply.code(400).send({
        error: 'You cannot change your own role or active status here',
      });
    }
    // Look up the target row first so we can enforce the protected-user
    // guards before issuing the UPDATE.
    const [target] = await db
      .select({
        id: schema.adminUsers.id,
        isProtected: schema.adminUsers.isProtected,
        role: schema.adminUsers.role,
      })
      .from(schema.adminUsers)
      .where(
        and(
          eq(schema.adminUsers.id, params.data.id),
          tenantFilter(session.user, schema.adminUsers.tenantId),
        ),
      )
      .limit(1);
    if (!target) return reply.code(404).send({ error: 'Not found' });
    if (target.isProtected) {
      if (body.data.isActive === false) {
        return reply.code(403).send({
          error: 'protected_user',
          message:
            'The bootstrap super admin cannot be deactivated. This account is required for the system to remain operable.',
        });
      }
      if (body.data.role !== undefined && body.data.role !== 'super_admin') {
        return reply.code(403).send({
          error: 'protected_user',
          message:
            'The bootstrap super admin cannot be demoted from super_admin.',
        });
      }
    }
    const [row] = await db
      .update(schema.adminUsers)
      .set({ ...body.data, updatedAt: sql`now()` })
      .where(
        and(
          eq(schema.adminUsers.id, params.data.id),
          tenantFilter(session.user, schema.adminUsers.tenantId),
        ),
      )
      .returning(publicColumns);
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return { data: row };
  });

  // Delete an admin user. Blocks deletion of the bootstrap super admin and
  // self-delete (lockout prevention).
  fastify.delete('/:id', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
    const session = getSession(request);
    if (params.data.id === session.user.id) {
      return reply.code(400).send({
        error: 'self_delete_blocked',
        message: 'You cannot delete your own account.',
      });
    }
    const [target] = await db
      .select({
        id: schema.adminUsers.id,
        isProtected: schema.adminUsers.isProtected,
      })
      .from(schema.adminUsers)
      .where(
        and(
          eq(schema.adminUsers.id, params.data.id),
          tenantFilter(session.user, schema.adminUsers.tenantId),
        ),
      )
      .limit(1);
    if (!target) return reply.code(404).send({ error: 'Not found' });
    if (target.isProtected) {
      return reply.code(403).send({
        error: 'protected_user',
        message:
          'The bootstrap super admin cannot be deleted. This account is required for the system to remain operable.',
      });
    }
    await db
      .delete(schema.adminUsers)
      .where(
        and(
          eq(schema.adminUsers.id, params.data.id),
          tenantFilter(session.user, schema.adminUsers.tenantId),
        ),
      );
    return reply.code(204).send();
  });

  // Reset a user's password to a fresh temporary one (returned once).
  fastify.post('/:id/reset-password', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
    const session = getSession(request);
    const tempPassword = generateTempPassword();
    const [row] = await db
      .update(schema.adminUsers)
      .set({
        hashedPassword: await hashPassword(tempPassword),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schema.adminUsers.id, params.data.id),
          tenantFilter(session.user, schema.adminUsers.tenantId),
        ),
      )
      .returning({ id: schema.adminUsers.id });
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return { data: { id: row.id, tempPassword } };
  });
};
