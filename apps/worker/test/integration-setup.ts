// Per-file integration setup. Runs before each *.integration.test.ts file.
//
// CRITICAL: .env.test must load BEFORE any @cms/* import — @cms/config
// validates env at module-load time, so a stale process.env would throw or use
// wrong values. All project imports go through a dynamic import block after
// loadEnvFile so ordering is explicit.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, '../.env.test');

if (!existsSync(envFile)) {
  throw new Error(
    `Missing apps/worker/.env.test — copy from the committed file or create one.\n` +
      `Looked at: ${envFile}`,
  );
}
process.loadEnvFile(envFile);

// Now safe to import anything that pulls @cms/config / @cms/db.
const [
  { migrate },
  cmsDb,
  cmsConfig,
  { default: Redis },
  awsS3,
  search,
] = await Promise.all([
  import('drizzle-orm/postgres-js/migrator'),
  import('@cms/db'),
  import('@cms/config'),
  import('ioredis'),
  import('@aws-sdk/client-s3'),
  import('@cms/search'),
]);

// ─── 1. Migrate cms_test (uses @cms/db's already-configured client) ──────────
const migrationsFolder = resolve(__dirname, '../../../packages/db/migrations');
// migrate() is idempotent — drizzle tracks applied migrations in
// __drizzle_migrations, so running this per-file just no-ops after the first.
// db is typed as PostgresJsDatabase<typeof schema>; migrate expects the
// less-specific base type, so we cast through `unknown` rather than `any`.
const migrationDb =
  cmsDb.db as unknown as Parameters<typeof migrate>[0];
await migrate(migrationDb, { migrationsFolder });

// ─── 2. Ensure the dedicated test bucket exists ──────────────────────────────
const s3 = new awsS3.S3Client({
  endpoint: cmsConfig.env.S3_ENDPOINT,
  region: cmsConfig.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: cmsConfig.env.S3_ACCESS_KEY_ID,
    secretAccessKey: cmsConfig.env.S3_SECRET_ACCESS_KEY,
  },
});
const bucket = cmsConfig.env.S3_BUCKET;
try {
  await s3.send(new awsS3.HeadBucketCommand({ Bucket: bucket }));
} catch {
  await s3.send(new awsS3.CreateBucketCommand({ Bucket: bucket }));
}

// ─── 3. Configure + clear Meili content index ────────────────────────────────
await search.ensureContentIndexConfig();
try {
  await search.meili
    .index(search.CONTENT_INDEX_NAME)
    .deleteAllDocuments()
    .waitTask();
} catch {
  // index may still be initializing
}

// ─── 4. Flush only the test Redis db (db 15 via REDIS_URL) ───────────────────
// FLUSHDB is scoped to the currently-selected database — db 15 here. The
// FLUSHALL footgun is explicitly avoided so dev queues in db 0 stay intact.
const flushRedis = new Redis(cmsConfig.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
});
try {
  await flushRedis.flushdb();
} finally {
  flushRedis.disconnect();
}
