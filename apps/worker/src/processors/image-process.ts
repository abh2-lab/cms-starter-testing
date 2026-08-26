import { eq } from 'drizzle-orm';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import sharp from 'sharp';
import { db, schema } from '@cms/db';
import { env } from '@cms/config';
import {
  dispatchEvent,
  ImageProcessJob,
  type Producers,
  QUEUE_NAMES,
} from '@cms/queue';

import { getObjectBytes, putObjectBytes } from '../lib/s3.js';
import { jobMeta, type Logger } from '../logger.js';

export interface VariantSpec {
  key: string;
  longEdge: number;
  format: 'webp' | 'avif';
  quality: number;
  contentType: string;
  ext: string;
}

// Variant list — webp covers everything; avif added at thumb + hero sizes
// where modern browsers benefit most and the encode cost is justified.
// withoutEnlargement: true on sharp.resize keeps small inputs from being
// upscaled, so generating fewer rows for tiny uploads is automatic.
//
// Exported so tests (and Bull Board / admin UI) can introspect the list
// without parsing through the processor closure.
export const VARIANTS: readonly VariantSpec[] = [
  { key: 'thumb_webp_200', longEdge: 200, format: 'webp', quality: 80, contentType: 'image/webp', ext: 'webp' },
  { key: 'thumb_avif_200', longEdge: 200, format: 'avif', quality: 50, contentType: 'image/avif', ext: 'avif' },
  { key: 'sm_webp_400', longEdge: 400, format: 'webp', quality: 80, contentType: 'image/webp', ext: 'webp' },
  { key: 'md_webp_800', longEdge: 800, format: 'webp', quality: 80, contentType: 'image/webp', ext: 'webp' },
  { key: 'lg_webp_1600', longEdge: 1600, format: 'webp', quality: 80, contentType: 'image/webp', ext: 'webp' },
  { key: 'lg_avif_1600', longEdge: 1600, format: 'avif', quality: 50, contentType: 'image/avif', ext: 'avif' },
];

// Hard ceiling on input size we'll try to process in-memory. News images are
// well under this; bigger uploads would need a streamed pipeline.
const MAX_INPUT_BYTES = 32 * 1024 * 1024;

/**
 * Compute the variant storage key from the original. Strips the basename and
 * appends `<variantKey>.<ext>` so re-runs overwrite cleanly, and so all the
 * variants for one master sit next to it in the bucket listing.
 *
 * Original: tenant/2026/05/<uuid>/photo.jpg
 * Variant:  tenant/2026/05/<uuid>/photo--thumb_webp_200.webp
 *
 * Exported for tests. Pure — no IO.
 */
export function variantStorageKey(
  originalKey: string,
  variant: VariantSpec,
): string {
  const lastSlash = originalKey.lastIndexOf('/');
  const dir = lastSlash >= 0 ? originalKey.slice(0, lastSlash) : '';
  const file = originalKey.slice(lastSlash + 1);
  const dotIdx = file.lastIndexOf('.');
  const stem = dotIdx > 0 ? file.slice(0, dotIdx) : file;
  return `${dir}/${stem}--${variant.key}.${variant.ext}`;
}

export function registerImageProcessWorker(
  connection: Redis,
  producers: Producers,
  log: Logger,
): Worker {
  const worker = new Worker<ImageProcessJob>(
    QUEUE_NAMES.imageProcess,
    async (job: Job<ImageProcessJob>) => {
      const parsed = ImageProcessJob.safeParse(job.data);
      if (!parsed.success) {
        throw new UnrecoverableError('malformed image-process payload');
      }
      const { mediaId, tenantId, storageKey } = parsed.data;
      const childLog = log.child({
        queue: QUEUE_NAMES.imageProcess,
        jobId: job.id,
        mediaId,
        tenantId,
        ...jobMeta(job.data),
      });

      // Re-read media row; bail (no-op) if someone deleted it or it's already
      // processed (idempotent — BullMQ at-least-once redelivery is safe).
      const [media] = await db
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, mediaId))
        .limit(1);
      if (!media) {
        childLog.info('media row gone; skipping');
        return { skipped: 'gone' };
      }
      if (media.processingStatus !== 'pending') {
        childLog.info(
          { status: media.processingStatus },
          'media not pending; skipping',
        );
        return { skipped: 'not-pending' };
      }

      // Mark in-flight
      await db
        .update(schema.media)
        .set({ processingStatus: 'processing', updatedAt: new Date() })
        .where(eq(schema.media.id, mediaId));

      try {
        const originalBytes = await getObjectBytes(storageKey);
        if (originalBytes.byteLength > MAX_INPUT_BYTES) {
          throw new UnrecoverableError(
            `input too large: ${originalBytes.byteLength} bytes > ${MAX_INPUT_BYTES}`,
          );
        }

        // Validate decode + extract dimensions
        let metadata: sharp.Metadata;
        try {
          metadata = await sharp(originalBytes).metadata();
        } catch (err) {
          // Sharp throws "Input buffer contains unsupported image format"
          // on non-image inputs. Terminal — operator must re-upload.
          throw new UnrecoverableError(
            `not decodable: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const srcLong = Math.max(metadata.width ?? 0, metadata.height ?? 0);

        // Generate variants sequentially — sharp/libvips is multi-threaded
        // internally; parallel jobs would saturate CPU and starve other queues.
        const generated: Array<{
          variantKey: string;
          storageKey: string;
          mimeType: string;
          fileSizeBytes: number;
          width: number | null;
          height: number | null;
        }> = [];

        for (const variant of VARIANTS) {
          // Skip variants whose target dimension exceeds the input — no point
          // generating an "lg_webp_1600" for a 600px source.
          if (srcLong > 0 && variant.longEdge > srcLong) {
            childLog.debug(
              { variant: variant.key, srcLong },
              'skipping oversized variant',
            );
            continue;
          }
          const pipe = sharp(originalBytes)
            .rotate() // honor EXIF orientation
            .resize({
              width: variant.longEdge,
              height: variant.longEdge,
              fit: 'inside',
              withoutEnlargement: true,
            });
          const buffer =
            variant.format === 'webp'
              ? await pipe.webp({ quality: variant.quality }).toBuffer({ resolveWithObject: true })
              : await pipe.avif({ quality: variant.quality }).toBuffer({ resolveWithObject: true });

          const key = variantStorageKey(storageKey, variant);
          await putObjectBytes({
            key,
            body: buffer.data,
            contentType: variant.contentType,
          });

          generated.push({
            variantKey: variant.key,
            storageKey: key,
            mimeType: variant.contentType,
            fileSizeBytes: buffer.info.size,
            width: buffer.info.width,
            height: buffer.info.height,
          });
        }

        // Batched insert with idempotent conflict resolution — retries land on
        // the same variantKey rows and overwrite is unnecessary (PUT to S3
        // is last-write-wins; the row metadata is the same).
        if (generated.length > 0) {
          await db
            .insert(schema.mediaVariants)
            .values(
              generated.map((g) => ({
                mediaId,
                variantKey: g.variantKey,
                storageKey: g.storageKey,
                mimeType: g.mimeType,
                fileSizeBytes: g.fileSizeBytes,
                width: g.width,
                height: g.height,
              })),
            )
            .onConflictDoNothing();
        }

        // Final state — store helpful metadata next to the row.
        const exifStripped =
          metadata.exif !== undefined || metadata.iptc !== undefined;
        await db
          .update(schema.media)
          .set({
            processingStatus: 'ready',
            width: metadata.width ?? null,
            height: metadata.height ?? null,
            metadata: {
              format: metadata.format ?? null,
              variants: generated.length,
              exifStripped,
            },
            updatedAt: new Date(),
          })
          .where(eq(schema.media.id, mediaId));

        // Webhook fan-out — media.processed signals subscribers that variants
        // are now available.
        void dispatchEvent({
          producers,
          log,
          eventName: 'media.processed',
          payload: { id: mediaId, variants: generated.length },
          tenantId,
        });

        childLog.info(
          { variants: generated.length, durationMs: 0 },
          'image-process completed',
        );
        return { ok: true, variants: generated.length };
      } catch (err) {
        // Mark failed with a usable error so the UI can surface "Reprocess".
        // UnrecoverableError will skip the rest of BullMQ's retries; transient
        // errors throw normally and the next attempt re-runs.
        await db
          .update(schema.media)
          .set({
            processingStatus: 'failed',
            metadata: {
              error: err instanceof Error ? err.message : String(err),
              failedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(schema.media.id, mediaId));
        throw err;
      }
    },
    {
      connection,
      concurrency: env.WORKER_IMAGE_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    log.warn(
      {
        queue: QUEUE_NAMES.imageProcess,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'image-process job failed',
    );
  });

  return worker;
}
