import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolveStorageConfig } from './storage-config.js';

// Module-scoped clients + bucket, sourced from `storage_settings` (with env
// fallback inside resolveStorageConfig). Mutable so the admin → Settings →
// Infrastructure → Storage save path can call reloadStorageClients() and have
// the new config picked up without a process restart. All exported functions
// reference these via closure so callers don't have to thread anything.
//
// Single-tenant scope: this layer operates on the NULL-tenant settings row.
// When/if multi-tenant lookups land, swap the singletons for a per-tenant
// Map<tenantId, ...> + per-version cache (mirror the email transport pattern
// in apps/worker/src/processors/email-send.ts).
let s3Client: S3Client;
let presignClient: S3Client;
let bucket: string;
let publicUrl: string;
let configVersion = -1;

const PRESIGN_PUT_TTL_SECONDS = 600; // 10 min to complete a direct upload
const PRESIGN_GET_TTL_SECONDS = 3600; // 1 h display URL

/**
 * Build the S3 clients from `storage_settings` (with env fallback). Called
 * once at boot, plus on every successful admin storage-settings PATCH so the
 * change takes effect on the next presign/upload without a restart. Idempotent
 * when `version` is unchanged.
 *
 * `tenantId` selects which `storage_settings` row to resolve from. Boot passes
 * `null` (env fallback when no NULL-tenant row exists). The PATCH handler
 * passes the saving admin's `session.user.tenantId` so the cached clients
 * actually pick up the row that was just written — in single-tenant installs
 * the admin's session always carries the publisher's real tenant id, and
 * saving into that row used to be invisible to this reload because we always
 * queried `tenantId: null` here.
 */
export async function reloadStorageClients(
  tenantId: string | null = null,
): Promise<void> {
  const { config, version } = await resolveStorageConfig({ tenantId });
  if (version === configVersion && s3Client) return;
  configVersion = version;

  s3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  // Browser-facing presigned URLs must be signed against an endpoint the
  // browser can reach over HTTPS. In a containerized deploy `endpoint` is an
  // internal hostname (http://minio:9000) — the browser can't resolve it and
  // HTTP would be blocked as mixed content on an HTTPS page. Sign against
  // `publicEndpoint` instead when set. Falls back to `s3Client` when blank
  // (real AWS S3, or local dev where the browser hits the same host the API
  // does).
  presignClient =
    config.publicEndpoint && config.publicEndpoint !== config.endpoint
      ? new S3Client({
          endpoint: config.publicEndpoint,
          region: config.region,
          forcePathStyle: config.forcePathStyle,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        })
      : s3Client;

  bucket = config.bucket;
  publicUrl = config.publicUrl;
}

function ensureClients(): void {
  if (!s3Client) {
    throw new Error(
      'S3 clients not initialised — call reloadStorageClients() at boot before any storage operation.',
    );
  }
}

// Strip a filename down to a safe object-key segment, preserving the extension.
function sanitizeFilename(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.length > 0 ? cleaned : 'file';
}

// Tenant-scoped, collision-resistant key: <tenant>/<yyyy>/<mm>/<uuid>/<name>.
export function buildStorageKey(tenantId: string, filename: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${tenantId}/${yyyy}/${mm}/${randomUUID()}/${sanitizeFilename(filename)}`;
}

// Presigned PUT URL the browser uploads the bytes to directly.
export function presignPut(
  storageKey: string,
  contentType: string,
): Promise<string> {
  ensureClients();
  return getSignedUrl(
    presignClient,
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: contentType,
    }),
    { expiresIn: PRESIGN_PUT_TTL_SECONDS },
  );
}

// A display URL for an object: the configured public/CDN base when set,
// otherwise a short-lived presigned GET URL.
export function objectUrl(storageKey: string): Promise<string> {
  // Pass-through for absolute http(s) URLs. Real storage keys produced by
  // buildStorageKey() always start with the tenant UUID — they can never
  // have an http(s) scheme — so this branch only matches dev-seed
  // placeholders (e.g. picsum.photos URLs) embedded directly in the key
  // column.
  if (storageKey.startsWith('http://') || storageKey.startsWith('https://')) {
    return Promise.resolve(storageKey);
  }
  ensureClients();
  if (publicUrl) {
    const base = publicUrl.replace(/\/$/, '');
    return Promise.resolve(`${base}/${storageKey}`);
  }
  return getSignedUrl(
    presignClient,
    new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    { expiresIn: PRESIGN_GET_TTL_SECONDS },
  );
}

export async function deleteObject(storageKey: string): Promise<void> {
  ensureClients();
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
  );
}

// Reachability check for the dashboard health panel.
export async function checkStorage(): Promise<boolean> {
  try {
    ensureClients();
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}

// Internal access for the storage-settings POST /test endpoint — runs a
// head-bucket against the credentials in `storage_settings` so the admin can
// confirm a save before relying on it. Builds throwaway clients from the
// supplied config so the test can run BEFORE reloadStorageClients() picks up
// the just-saved row.
export async function testStorageConfig(args: {
  endpoint: string;
  publicEndpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = new S3Client({
    endpoint: args.endpoint,
    region: args.region,
    forcePathStyle: args.forcePathStyle,
    credentials: {
      accessKeyId: args.accessKeyId,
      secretAccessKey: args.secretAccessKey,
    },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: args.bucket }));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Bucket check failed',
    };
  } finally {
    client.destroy();
  }
}

// Re-exported for any caller that needs the raw client (kept for backward
// compatibility with worker test helpers + dashboard health checks). New code
// should prefer the wrapped exports above.
export function getRawS3Client(): S3Client {
  ensureClients();
  return s3Client;
}

export function getCurrentBucket(): string {
  ensureClients();
  return bucket;
}
