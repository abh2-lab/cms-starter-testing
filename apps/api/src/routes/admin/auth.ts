import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { resolveSiteUrl } from '../../lib/site-url.js';
import { verifyPassword } from '../../services/password.js';
import {
  createAdminSession,
  lookupAdminSession,
  revokeAdminSession,
} from '../../services/session.js';
import {
  applySessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SEC,
} from '../../services/session-cookie.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';

// Re-export so existing imports of SESSION_COOKIE_NAME from this module
// (e.g. server.ts swagger config, middleware/require-auth.ts) keep working.
export { SESSION_COOKIE_NAME };

const LoginBodySchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  // Length validation belongs at signup, not login — we accept whatever
  // the user provides and let verifyPassword fail the comparison.
  password: z.string().min(1),
});

export const adminAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/login', async (request, reply) => {
    const parsed = LoginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const { email, password } = parsed.data;

    // Single error shape for "no such user" and "wrong password" — never
    // leak whether the email exists in the system.
    const denyAuth = () =>
      reply.code(401).send({ error: 'Invalid email or password' });

    const [user] = await db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.email, email))
      .limit(1);

    if (!user || !user.isActive) {
      return denyAuth();
    }

    const passwordOk = await verifyPassword(password, user.hashedPassword);
    if (!passwordOk) {
      return denyAuth();
    }

    const session = await createAdminSession({
      userId: user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      ttlSec: SESSION_TTL_SEC,
    });

    // Fire-and-forget last_login_at update. Don't block the response on it;
    // a failure here doesn't invalidate the successful auth.
    db.update(schema.adminUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.adminUsers.id, user.id))
      .catch((err: unknown) => {
        fastify.log.error({ err, userId: user.id }, 'last_login_at update failed');
      });

    return applySessionCookie(reply, session.token).send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        tenantId: user.tenantId,
        isProtected: user.isProtected,
        tourCompletedAt: user.tourCompletedAt
          ? user.tourCompletedAt.toISOString()
          : null,
      },
      expiresAt: session.expiresAt.toISOString(),
      publicWebUrl: await resolveSiteUrl(user.tenantId),
    });
  });

  // GET /me — return the authenticated admin user. 401 if not logged in.
  fastify.get(
    '/me',
    { preHandler: requireAdminAuth },
    async (request) => {
      // requireAdminAuth guarantees adminSession is set; the non-null
      // assertion here is enforced by the preHandler.
      const session = request.adminSession;
      if (!session) {
        // Defensive: should never happen because preHandler returns 401.
        throw fastify.httpErrors.internalServerError(
          'adminSession missing after requireAdminAuth',
        );
      }
      return {
        user: {
          id: session.user.id,
          email: session.user.email,
          displayName: session.user.displayName,
          role: session.user.role,
          tenantId: session.user.tenantId,
          isProtected: session.user.isProtected,
          tourCompletedAt: session.user.tourCompletedAt
            ? session.user.tourCompletedAt.toISOString()
            : null,
        },
        expiresAt: session.session.expiresAt.toISOString(),
        publicWebUrl: await resolveSiteUrl(session.user.tenantId),
      };
    },
  );

  // POST /logout — idempotent. Revokes the resolved session if present and
  // always clears the cookie. Never errors on stale / unknown cookies.
  //
  // Cookie-clear attributes MUST match the original setCookie attributes
  // (path, httpOnly, secure, sameSite) — browsers identify a cookie by its
  // name+domain+path tuple and may refuse to overwrite if attributes drift,
  // leaving the user "still logged in" after sign-out + reload.
  fastify.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) {
      const lookup = await lookupAdminSession(token);
      if (lookup) {
        await revokeAdminSession(lookup.session.id);
      }
    }
    return clearSessionCookie(reply).send({ ok: true });
  });
};
