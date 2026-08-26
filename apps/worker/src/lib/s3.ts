import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '@cms/config';

/**
 * Worker-side S3 client for image-variant uploads and original downloads.
 * Configured identically to apps/api/src/lib/s3.ts so both processes hit the
 * same bucket. Kept as a copy rather than extracted to a shared package —
 * the surface area is small and tightly coupled to its host's responsibilities.
 */
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

/**
 * Download an object as a Buffer. Used by the image processor — variant
 * generation is bounded so the whole file in memory is fine for news images
 * (target <10 MB; tested up to ~32 MB).
 */
export async function getObjectBytes(storageKey: string): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }),
  );
  if (!res.Body) throw new Error(`empty body for s3 key ${storageKey}`);
  // transformToByteArray() returns Uint8Array; Buffer.from(...) wraps without copy.
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function putObjectBytes(args: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
}
