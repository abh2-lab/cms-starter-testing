import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, schema } from '@cms/db';

// The raw token is 32 random bytes hex-encoded = 64 chars, ~256 bits of entropy.
// The DB only stores SHA-256(token); a DB leak therefore can't reuse sessions.
const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('hex');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreateAdminSessionInput {
  userId: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  ttlSec?: number;
}

export interface CreatedAdminSession {
  /**
   * The raw, unhashed session token. ONLY available here — set in the
   * httpOnly cookie and never logged or stored.
   */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export async function createAdminSession(
  input: CreateAdminSessionInput,
): Promise<CreatedAdminSession> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const ttl = input.ttlSec ?? DEFAULT_SESSION_TTL_SEC;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const [row] = await db
    .insert(schema.adminSessions)
    .values({
      userId: input.userId,
      tokenHash,
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning({
      id: schema.adminSessions.id,
      expiresAt: schema.adminSessions.expiresAt,
    });

  if (!row) {
    throw new Error('Failed to insert admin session');
  }

  return { token, sessionId: row.id, expiresAt: row.expiresAt };
}

export type AdminSessionRow = typeof schema.adminSessions.$inferSelect;
export type AdminUserRow = typeof schema.adminUsers.$inferSelect;

export interface AdminSessionLookupResult {
  session: AdminSessionRow;
  user: AdminUserRow;
}

/**
 * Resolve a raw session token to its session row + user. Returns null when
 * the token is unknown, the session is revoked, the session is expired, or
 * the user is deactivated. Callers should treat null as "not authenticated".
 */
export async function lookupAdminSession(
  rawToken: string,
): Promise<AdminSessionLookupResult | null> {
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();

  const rows = await db
    .select({
      session: schema.adminSessions,
      user: schema.adminUsers,
    })
    .from(schema.adminSessions)
    .innerJoin(
      schema.adminUsers,
      eq(schema.adminUsers.id, schema.adminSessions.userId),
    )
    .where(
      and(
        eq(schema.adminSessions.tokenHash, tokenHash),
        isNull(schema.adminSessions.revokedAt),
        gt(schema.adminSessions.expiresAt, now),
        eq(schema.adminUsers.isActive, true),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Mark a single session revoked. Idempotent — calling on an already-revoked
 *  session is a no-op.
 */
export async function revokeAdminSession(sessionId: string): Promise<void> {
  await db
    .update(schema.adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.adminSessions.id, sessionId),
        isNull(schema.adminSessions.revokedAt),
      ),
    );
}

/** Revoke every active session for a user. Use on password change or
 *  "log out everywhere".
 */
export async function revokeAllAdminSessionsForUser(
  userId: string,
): Promise<void> {
  await db
    .update(schema.adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.adminSessions.userId, userId),
        isNull(schema.adminSessions.revokedAt),
      ),
    );
}
