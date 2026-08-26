import { eq, isNull } from 'drizzle-orm';
import { db, isUndefinedTableError, schema } from '@cms/db';
import { decryptWebhookSecret } from '@cms/queue';
import { env } from '@cms/config';

// Resolved storage config + a change-token. Callers cache the built S3 clients
// keyed by `version` so the SDK connection pool is reused across requests
// until the admin saves new settings — mirrors `resolveEmailConfig`.
export interface ResolvedStorageConfig {
  /** S3-compatible API endpoint used by SERVER-side commands (head, delete, upload). */
  endpoint: string;
  /** S3 API endpoint used to sign browser-facing presigned URLs. Empty = use `endpoint`. */
  publicEndpoint: string;
  /** Optional CDN/origin for public GET URLs. Empty = hand out presigned GETs instead. */
  publicUrl: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  /** Provider label — cosmetic; the underlying API is S3-compatible regardless. */
  provider: 'minio' | 'aws' | 'r2' | 'do' | 'gcs';
}

export interface ResolvedStorage {
  config: ResolvedStorageConfig;
  /** updatedAt epoch-ms of the storage_settings row, or 0 for the env fallback. */
  version: number;
}

function decryptOrEmpty(buf: Buffer | null): string {
  if (!buf || buf.length === 0) return '';
  try {
    return decryptWebhookSecret(buf);
  } catch {
    // Stale ciphertext (encryption key rotated) — treat as unset so the env
    // fallback below takes effect rather than crashing the storage layer.
    return '';
  }
}

// Read the per-tenant storage_settings row, decrypt the secret key, and merge
// with env-var defaults for any field the operator left blank. Both layers
// keep working: an install that never touches the dashboard runs entirely on
// env, and an install that fills the dashboard can leave env unset (provided
// initial boot still has REQUIRED env to validate @cms/config).
export async function resolveStorageConfig(args: {
  tenantId: string | null;
}): Promise<ResolvedStorage> {
  let row: typeof schema.storageSettings.$inferSelect | undefined;
  try {
    [row] = await db
      .select()
      .from(schema.storageSettings)
      .where(
        args.tenantId === null
          ? isNull(schema.storageSettings.tenantId)
          : eq(schema.storageSettings.tenantId, args.tenantId),
      )
      .limit(1);
  } catch (err) {
    // Pre-migrate state: table doesn't exist yet. Fall back to S3_* env so
    // boot completes; the operator gets a one-shot warning telling them to
    // run migrations.
    if (isUndefinedTableError(err, 'storage_settings')) {
      return { config: envFallbackConfig(), version: 0 };
    }
    throw err;
  }

  if (!row) return { config: envFallbackConfig(), version: 0 };

  const secret = decryptOrEmpty(row.secretAccessKeyEncrypted);

  // Per-field env fallback: anything blank in the row falls back to env. Lets
  // the operator partially override (e.g. swap just the bucket name) without
  // having to redeclare every value.
  const config: ResolvedStorageConfig = {
    endpoint: env.S3_ENDPOINT,
    publicEndpoint:
      row.publicApiEndpoint && row.publicApiEndpoint.length > 0
        ? row.publicApiEndpoint
        : env.S3_PUBLIC_ENDPOINT,
    publicUrl:
      row.publicMediaUrl && row.publicMediaUrl.length > 0
        ? row.publicMediaUrl
        : env.S3_PUBLIC_URL,
    region:
      row.region && row.region.length > 0 ? row.region : env.S3_REGION,
    bucket: row.bucket.length > 0 ? row.bucket : env.S3_BUCKET,
    forcePathStyle: row.forcePathStyle,
    accessKeyId:
      row.accessKeyId && row.accessKeyId.length > 0
        ? row.accessKeyId
        : env.S3_ACCESS_KEY_ID,
    secretAccessKey: secret.length > 0 ? secret : env.S3_SECRET_ACCESS_KEY,
    provider: row.provider,
  };

  return { config, version: row.updatedAt.getTime() };
}

function envFallbackConfig(): ResolvedStorageConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    publicUrl: env.S3_PUBLIC_URL,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    provider: 'minio',
  };
}
