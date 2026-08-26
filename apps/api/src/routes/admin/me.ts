import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { requireAdminAuth } from '../../middleware/require-auth.js';

/**
 * "Me" endpoints — anything the authenticated admin does TO their own account
 * that isn't user-management (which is super_admin-only and lives in users.ts).
 * Mounted at /api/admin/me.
 */
export const adminMeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // POST /tour/complete — idempotent. Marks the welcome tour as seen so the
  // dashboard auto-trigger stops firing. The "?" help drawer's Replay button
  // does NOT call this — it just re-opens the tour locally without touching
  // server state.
  fastify.post('/tour/complete', async (request) => {
    const session = request.adminSession;
    if (!session) {
      throw fastify.httpErrors.internalServerError(
        'adminSession missing after requireAdminAuth',
      );
    }
    if (session.user.tourCompletedAt) {
      // Already completed — short-circuit and return the existing timestamp
      // so the client can reconcile its local state without a write.
      return {
        tourCompletedAt: session.user.tourCompletedAt.toISOString(),
      };
    }
    const [row] = await db
      .update(schema.adminUsers)
      .set({ tourCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.adminUsers.id, session.user.id))
      .returning({ tourCompletedAt: schema.adminUsers.tourCompletedAt });
    return {
      tourCompletedAt: row?.tourCompletedAt
        ? row.tourCompletedAt.toISOString()
        : new Date().toISOString(),
    };
  });
};
