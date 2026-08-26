import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasScope, parseApiKeyHeader } from '../lib/api-key-utils.js';
import {
  type ApiKeyAuth,
  lookupApiKey,
  touchApiKeyLastUsed,
} from '../services/api-key.js';

// Augment Fastify's request type so handlers can reach the resolved API key.
declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyAuth;
  }
}

/**
 * Fastify preHandler: resolves the API key from the `Authorization: Bearer`
 * (or `X-API-Key`) header. Rejects with 401 if the header is missing or the
 * key is unknown / revoked / expired. Mirrors requireAdminAuth.
 *
 * Usage:
 *   fastify.get('/some-route', { preHandler: requireApiKey }, handler)
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const rawKey = parseApiKeyHeader(request.headers);
  if (!rawKey) {
    await reply.code(401).send({ error: 'Invalid API key' });
    return;
  }

  const auth = await lookupApiKey(rawKey);
  if (!auth) {
    await reply.code(401).send({ error: 'Invalid API key' });
    return;
  }

  request.apiKey = auth;

  // Best-effort usage tracking — never block or fail a valid request on it.
  void touchApiKeyLastUsed(auth.id).catch((err: unknown) => {
    request.log.warn(
      { err, apiKeyId: auth.id },
      'failed to update api_keys.last_used_at',
    );
  });
}

/**
 * Fastify preHandler factory: requires the authenticated key to carry a given
 * scope. MUST run after requireApiKey (which populates request.apiKey). Returns
 * 401 if no key, 403 if the scope is absent. Mirrors requireAdminRole.
 */
export function requireScope(scope: string) {
  return async function scopePreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const auth = request.apiKey;
    if (!auth) {
      await reply.code(401).send({ error: 'Invalid API key' });
      return;
    }
    if (!hasScope(auth.scopes, scope)) {
      await reply.code(403).send({ error: 'Insufficient scope' });
      return;
    }
  };
}
