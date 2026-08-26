import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  type AdminSessionLookupResult,
  lookupAdminSession,
} from '../services/session.js';
import { SESSION_COOKIE_NAME } from '../routes/admin/auth.js';

// Augment Fastify's request type so handlers can reach the resolved session.
declare module 'fastify' {
  interface FastifyRequest {
    adminSession?: AdminSessionLookupResult;
  }
}

/**
 * Fastify preHandler: resolves the admin session from the cookie. Rejects
 * with 401 if the cookie is missing, the token is unknown, the session is
 * revoked/expired, or the user is deactivated.
 *
 * Usage:
 *   fastify.get('/some-protected', { preHandler: requireAdminAuth }, handler)
 */
export async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) {
    await reply.code(401).send({ error: 'Unauthenticated' });
    return;
  }

  const lookup = await lookupAdminSession(token);
  if (!lookup) {
    await reply.code(401).send({ error: 'Unauthenticated' });
    return;
  }

  request.adminSession = lookup;
  // Stamp identity onto every subsequent log line from this request. Pino's
  // child() returns a new logger that prepends the bindings; the resulting
  // events still carry Fastify's reqId so a single grep links auth → handler
  // → downstream job dispatch.
  request.log = request.log.child({
    userId: lookup.user.id,
    tenantId: lookup.user.tenantId,
  });
}
