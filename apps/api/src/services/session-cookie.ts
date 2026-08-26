import type { FastifyReply } from 'fastify';
import { env } from '@cms/config';

export const SESSION_COOKIE_NAME = 'cms_admin_session';
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

/**
 * Set the admin session cookie on the reply with the project-wide attributes.
 * Used by both the /auth/login endpoint and the First Boot Experience bootstrap
 * endpoint so the cookie shape (httpOnly, secure, sameSite, path) can't drift
 * between them — a drift would let one path issue a cookie the other can't
 * clear cleanly on logout.
 */
export function applySessionCookie(reply: FastifyReply, token: string): FastifyReply {
  return reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });
}

/**
 * Clear the admin session cookie with attributes that match applySessionCookie.
 * Browsers identify cookies by name+domain+path — clearing with mismatched
 * attributes silently leaves the original cookie intact.
 */
export function clearSessionCookie(reply: FastifyReply): FastifyReply {
  return reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}
