import { createHash } from 'node:crypto';

// Pure API-key helpers — no DB/config imports so they stay trivially
// unit-testable (the DB-backed lookup lives in services/api-key.ts).

// The DB only stores SHA-256(key) (api_keys.key_hash, unique). The raw key is
// shown once at creation and never recoverable — mirrors the session-token
// scheme in session.ts.
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const BEARER_PREFIX = 'Bearer ';

export interface ApiKeyHeaders {
  authorization?: string | undefined;
  'x-api-key'?: string | string[] | undefined;
}

/**
 * Extract the raw API key from request headers. Accepts
 * `Authorization: Bearer <key>` (canonical) or `X-API-Key: <key>`. Returns null
 * when neither carries a non-empty value.
 */
export function parseApiKeyHeader(headers: ApiKeyHeaders): string | null {
  const auth = headers.authorization;
  if (auth && auth.startsWith(BEARER_PREFIX)) {
    const token = auth.slice(BEARER_PREFIX.length).trim();
    if (token) return token;
  }
  const xApiKey = headers['x-api-key'];
  if (typeof xApiKey === 'string') {
    const token = xApiKey.trim();
    if (token) return token;
  }
  return null;
}

/** Does this key's scope set include the required scope? */
export function hasScope(scopes: readonly string[], required: string): boolean {
  return scopes.includes(required);
}
