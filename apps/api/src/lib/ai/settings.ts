import { db, schema } from '@cms/db';
import { decryptWebhookSecret } from '@cms/queue';
import { tenantFilter, type SessionLike } from '../tenant-scope.js';

// Runtime view of ai_settings for a request: secret decrypted at call time,
// `configured` precomputed (key + model + base URL all present). The chat
// route refuses unless `enabled && configured`; the status route returns only
// the two booleans (never the key/model/baseUrl) so non-super admins can gate
// the panel without reading the super-admin-only config route.
export interface AiRuntimeConfig {
  enabled: boolean;
  configured: boolean;
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
}

export async function loadAiConfig(user: SessionLike): Promise<AiRuntimeConfig> {
  const [row] = await db
    .select()
    .from(schema.aiSettings)
    .where(tenantFilter(user, schema.aiSettings.tenantId))
    .limit(1);

  if (!row) {
    return {
      enabled: false,
      configured: false,
      provider: null,
      model: null,
      baseUrl: null,
      apiKey: null,
    };
  }

  const apiKey =
    row.apiKeyEncrypted && row.apiKeyEncrypted.length > 0
      ? decryptWebhookSecret(row.apiKeyEncrypted)
      : null;

  return {
    enabled: row.enabled,
    configured: Boolean(apiKey && row.model && row.baseUrl),
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    apiKey,
  };
}
