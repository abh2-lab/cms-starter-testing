import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { env } from '@cms/config';
import { s3 } from '../../src/lib/s3.js';

export async function clearPrefix(prefix: string): Promise<void> {
  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix }),
  );
  for (const obj of list.Contents ?? []) {
    if (!obj.Key) continue;
    await s3.send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: obj.Key }),
    );
  }
}

export async function putBytes(args: {
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

export async function listKeys(prefix: string): Promise<string[]> {
  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix }),
  );
  return (list.Contents ?? [])
    .map((c) => c.Key)
    .filter((k): k is string => typeof k === 'string');
}
