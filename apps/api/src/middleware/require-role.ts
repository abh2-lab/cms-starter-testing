import type { FastifyReply, FastifyRequest } from 'fastify';

// Rank determines comparison. Higher rank = more privileged. New roles must
// be inserted in the right slot.
export const ADMIN_ROLE_RANK = {
  viewer: 1,
  author: 2,
  editor: 3,
  admin: 4,
  super_admin: 5,
} as const;

export type AdminRole = keyof typeof ADMIN_ROLE_RANK;

export function hasMinAdminRole(
  userRole: AdminRole,
  minRole: AdminRole,
): boolean {
  return ADMIN_ROLE_RANK[userRole] >= ADMIN_ROLE_RANK[minRole];
}

/**
 * Fastify preHandler factory: requires the authenticated admin user has
 * at least the given role. MUST run after requireAdminAuth (which
 * populates request.adminSession). Returns 401 if no session, 403 if
 * the user's role rank is below `minRole`.
 */
export function requireAdminRole(minRole: AdminRole) {
  return async function rolePreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const session = request.adminSession;
    if (!session) {
      await reply.code(401).send({ error: 'Unauthenticated' });
      return;
    }
    if (!hasMinAdminRole(session.user.role, minRole)) {
      await reply.code(403).send({ error: 'Insufficient role' });
      return;
    }
  };
}
