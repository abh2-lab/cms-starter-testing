import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { db, schema } from '@cms/db';
import { buildStorageKey, getCurrentBucket, getRawS3Client } from '../../lib/s3.js';
import { checkMediaUpload } from '../../lib/media-allowlist.js';
import type { SlugResolver } from './resolve.js';
import type { MediaFixture } from './schemas.js';

// Media seeder. For each entry in media.json:
//   1. Read the bytes from <mediaSourceDir>/<filename>.
//   2. Compute SHA-256 content hash for idempotency. If a row exists for
//      this tenant with the same hash, reuse its storage_key and skip the
//      upload entirely — the file is already in S3.
//   3. For images, extract width/height via sharp. For other types, leave NULL.
//   4. Generate a fresh storage_key (UUID-based; collision-resistant), upload
//      to S3 with the declared content-type, insert a media row.
//   5. Prime the resolver with filename → {storageKey, mediaId} so later
//      phases can resolve `{"$media": "<filename>"}` sentinels.
//
// Conflict policy: idempotent by CONTENT HASH (not filename). Re-running with
// the same files = zero inserts; renaming a file = zero inserts (same bytes);
// editing the alt/caption in media.json AND re-running = the existing row's
// alt/caption gets UPDATEd (structure-fixture-owned).

interface SeedMediaResult {
  media: number;
}

export async function seedMedia(args: {
  tenantId: string;
  fixtures: MediaFixture[];
  mediaSourceDir: string;
  resolver: SlugResolver;
}): Promise<SeedMediaResult> {
  let inserted = 0;

  for (const fixture of args.fixtures) {
    const srcPath = path.join(args.mediaSourceDir, fixture.filename);
    const bytes = await fs.readFile(srcPath);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const sizeBytes = bytes.byteLength;

    // Defence in depth: even though media.json declared the mime_type, double-
    // check against the allowlist before any upload. Otherwise a fixture could
    // smuggle a disallowed type past the admin UI's checks.
    const allowFailure = checkMediaUpload(fixture.mime_type, sizeBytes);
    if (allowFailure !== null) {
      throw new Error(
        `seed-media: ${fixture.filename}: ${allowFailure.message}`,
      );
    }

    // Idempotency check — same tenant + same content hash = same file.
    const existing = await db
      .select({
        id: schema.media.id,
        storageKey: schema.media.storageKey,
        altText: schema.media.altText,
        caption: schema.media.caption,
      })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.tenantId, args.tenantId),
          sql`${schema.media.metadata}->>'contentHash' = ${contentHash}`,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      // Structure-fixture-owned: refresh alt/caption if the fixture changed
      // them. originalFilename and storageKey are preserved.
      const newAlt = fixture.alt ?? null;
      const newCaption = fixture.caption ?? null;
      if (newAlt !== row.altText || newCaption !== row.caption) {
        await db
          .update(schema.media)
          .set({
            ...(newAlt !== null ? { altText: newAlt } : { altText: null }),
            ...(newCaption !== null ? { caption: newCaption } : { caption: null }),
            updatedAt: sql`NOW()`,
          })
          .where(eq(schema.media.id, row.id));
      }
      args.resolver.primeMedia(fixture.filename, {
        storageKey: row.storageKey,
        mediaId: row.id,
      });
      continue;
    }

    // New file — extract image metadata, upload, insert.
    const isImage = fixture.mime_type.startsWith('image/');
    let width: number | null = null;
    let height: number | null = null;
    if (isImage) {
      try {
        const meta = await sharp(bytes).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
      } catch {
        // Non-fatal: a non-decodable image (e.g. unsupported variant) still
        // gets uploaded and inserted with NULL dimensions; the public renderer
        // can fall back to the natural <img> size.
        width = null;
        height = null;
      }
    }

    const storageKey = buildStorageKey(args.tenantId, fixture.filename);
    await getRawS3Client().send(
      new PutObjectCommand({
        Bucket: getCurrentBucket(),
        Key: storageKey,
        Body: bytes,
        ContentType: fixture.mime_type,
      }),
    );

    const inserts = await db
      .insert(schema.media)
      .values({
        tenantId: args.tenantId,
        originalFilename: fixture.filename,
        storageKey,
        mimeType: fixture.mime_type,
        fileSizeBytes: sizeBytes,
        ...(width !== null ? { width } : {}),
        ...(height !== null ? { height } : {}),
        ...(fixture.alt !== undefined ? { altText: fixture.alt } : {}),
        ...(fixture.caption !== undefined ? { caption: fixture.caption } : {}),
        // Images go to 'pending' so the worker generates variants when up;
        // non-images go straight to 'ready' (no processing pipeline).
        processingStatus: isImage ? 'pending' : 'ready',
        metadata: { contentHash },
      })
      .returning({
        id: schema.media.id,
        storageKey: schema.media.storageKey,
      });

    if (inserts.length === 0) {
      throw new Error(
        `seed-media: insert returned no row for "${fixture.filename}"`,
      );
    }
    const row = inserts[0]!;
    args.resolver.primeMedia(fixture.filename, {
      storageKey: row.storageKey,
      mediaId: row.id,
    });
    inserted += 1;
  }

  return { media: inserted };
}
