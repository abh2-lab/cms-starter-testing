import { env } from '@cms/config';
import { closeRedis } from './lib/cache.js';
import { closeHealthRedis } from './lib/health-checks.js';
import { closeQueueProducers } from './lib/queue.js';
import { startAuditRetention } from './lib/audit-retention.js';
import { ensureContentIndexConfig } from './lib/meili-indexing.js';
import { reloadStorageClients } from './lib/s3.js';
import { initSentry } from './observability/sentry.js';
import { buildServer } from './server.js';

async function start(): Promise<void> {
  // Init *before* buildServer so any boot-time error gets captured. No-op
  // when no DSN is configured (env empty AND no monitoring_settings row), so
  // dev installs pay nothing.
  await initSentry();

  // Build the S3 clients from `storage_settings` (with S3_* env fallback) so
  // any route hit immediately after listen has working presign / objectUrl.
  // Failures fall through — the route-level operations will surface a clean
  // S3 error on first use rather than killing boot.
  await reloadStorageClients();

  const fastify = await buildServer();

  fastify.addHook('onClose', async () => {
    await closeRedis();
    await closeQueueProducers();
    await closeHealthRedis();
  });

  // Pin the content index's searchable/filterable/sortable attributes once
  // at boot. Idempotent and fail-open: a Meili outage logs a warning and
  // proceeds — search degrades but the API stays up.
  await ensureContentIndexConfig();

  // Schedule the daily audit_log cleanup. Runs ~1 minute after boot, then
  // every 24 hours; the onClose hook inside clears the timers on shutdown.
  startAuditRetention(fastify);

  // The nightly Meili drift reindex lives in the worker's maintenance queue
  // (see apps/worker/src/processors/maintenance.ts → meili-drift-sweep)
  // since Phase 6. No in-process timer here anymore.

  try {
    await fastify.listen({ port: env.API_PORT, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

void start();
