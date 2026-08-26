import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { objectUrl } from './s3.js';

// Resolve a media reference stored in custom_fields (e.g. hero_image_key) to a
// signed display URL. A reference may be EITHER:
//   - a media row id — what the admin media picker saves (and what body
//     inlineImage/gallery nodes use, see resolve-body-media.ts); resolved to
//     the row's storage_key, then signed; or
//   - a raw storage key / path — legacy seed data that stored the object path
//     directly; signed as-is.
// A bare-UUID reference that matches no media row resolves to null (the object
// was deleted) rather than a doomed 404 URL — the renderer then degrades to
// "no image". This fixes thumbnails set via the admin picker, whose id-form key
// objectUrl() previously signed as a (non-existent) object path.

const BARE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Batch-resolve many media references for one tenant. Returns a key → URL|null
 * map (deduped). Use this for archive/list rows so a 24-item grid issues ONE
 * media lookup, not 24.
 */
export async function resolveMediaRefUrls(
  tenantId: string,
  keys: Array<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [
    ...new Set(keys.filter((k): k is string => typeof k === 'string' && k.length > 0)),
  ];
  if (unique.length === 0) return out;

  // Look up the bare-UUID candidates as media ids → storage_key (tenant-scoped).
  const idCandidates = unique.filter((k) => BARE_UUID.test(k));
  const idToStorage = new Map<string, string>();
  if (idCandidates.length > 0) {
    const rows = await db
      .select({ id: schema.media.id, storageKey: schema.media.storageKey })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.tenantId, tenantId),
          inArray(schema.media.id, idCandidates),
        ),
      );
    for (const r of rows) idToStorage.set(r.id, r.storageKey);
  }

  await Promise.all(
    unique.map(async (key) => {
      if (BARE_UUID.test(key)) {
        // A media id: resolve to storage_key, or null when the row is gone.
        const storageKey = idToStorage.get(key);
        out.set(key, storageKey ? await objectUrl(storageKey) : null);
      } else {
        // A legacy storage path: sign directly.
        out.set(key, await objectUrl(key));
      }
    }),
  );
  return out;
}

/** Resolve a single media reference to a signed URL (or null). */
export async function resolveMediaRefUrl(
  tenantId: string,
  key: string,
): Promise<string | null> {
  const map = await resolveMediaRefUrls(tenantId, [key]);
  return map.get(key) ?? null;
}
