import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { hashApiKey } from '../lib/api-key-utils.js';

export interface ApiKeyAuth {
  id: string;
  tenantId: string;
  name: string;
  scopes: string[];
}

/**
 * Resolve a raw API key to its identity. Returns null when the key is unknown,
 * revoked, or expired — callers treat null as "unauthenticated". Mirrors
 * lookupAdminSession.
 */
export async function lookupApiKey(rawKey: string): Promise<ApiKeyAuth | null> {
  const keyHash = hashApiKey(rawKey);
  const now = new Date();

  const rows = await db
    .select({
      id: schema.apiKeys.id,
      tenantId: schema.apiKeys.tenantId,
      name: schema.apiKeys.name,
      scopes: schema.apiKeys.scopes,
    })
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.keyHash, keyHash),
        isNull(schema.apiKeys.revokedAt),
        or(isNull(schema.apiKeys.expiresAt), gt(schema.apiKeys.expiresAt, now)),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Record that a key was just used. Best-effort; callers need not await. */
export async function touchApiKeyLastUsed(id: string): Promise<void> {
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, id));
}
