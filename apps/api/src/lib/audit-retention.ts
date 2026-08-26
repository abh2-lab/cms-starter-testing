import type { FastifyInstance } from 'fastify';
import { AUDIT_RETENTION_DAYS, pruneOldAuditLogs } from './audit.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Delay the first run so it doesn't compete with the rest of API startup —
// in dev where the server restarts on every save, this also avoids
// thrashing the DB on hot-reload.
const STARTUP_DELAY_MS = 60_000;

/**
 * Boot a daily audit_log retention job inside the API process. Runs once
 * shortly after startup and then every 24 hours; cleans up on server close.
 *
 * In-process rather than a separate cron container so single-install
 * deployments (Coolify, docker-compose) don't need a sidecar. For ops
 * that prefer external scheduling, run `pnpm --filter @cms/api audit:prune`
 * from system cron instead and skip wiring this in.
 *
 * Safe under multi-instance scale-out: the DELETE is atomic and idempotent,
 * so several instances running it concurrently each end up deleting a slice
 * (the intersection of the same rows) — wasted work, never incorrect.
 */
export function startAuditRetention(fastify: FastifyInstance): void {
  const run = async (): Promise<void> => {
    try {
      const start = Date.now();
      const deleted = await pruneOldAuditLogs();
      fastify.log.info(
        {
          deleted,
          durationMs: Date.now() - start,
          retentionDays: AUDIT_RETENTION_DAYS,
        },
        `audit_log retention: deleted ${deleted} row(s) older than ${AUDIT_RETENTION_DAYS} days`,
      );
    } catch (err) {
      fastify.log.error({ err }, 'audit_log retention pruning failed');
    }
  };

  const initialTimer = setTimeout(() => {
    void run();
  }, STARTUP_DELAY_MS);
  const dailyTimer = setInterval(() => {
    void run();
  }, ONE_DAY_MS);

  fastify.addHook('onClose', async () => {
    if (initialTimer) clearTimeout(initialTimer);
    if (dailyTimer) clearInterval(dailyTimer);
  });
}
