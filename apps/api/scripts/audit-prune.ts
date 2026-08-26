/**
 * One-shot audit_log retention sweep.
 *
 * Usage:
 *   pnpm --filter @cms/api audit:prune          # use the default retention (30 days)
 *   pnpm --filter @cms/api audit:prune -- 7     # delete rows older than 7 days
 *
 * Intended for ops who prefer external cron (e.g. a Coolify scheduled task or
 * a k8s CronJob) over the API's in-process daily scheduler — they can disable
 * one and run the other. Safe to invoke at any time; idempotent.
 */
import { AUDIT_RETENTION_DAYS, pruneOldAuditLogs } from '../src/lib/audit.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  const days = arg === undefined ? AUDIT_RETENTION_DAYS : Number.parseInt(arg, 10);
  if (!Number.isFinite(days) || days < 1) {
    console.error(
      `audit:prune — invalid days argument "${arg}". Usage: audit:prune [days]`,
    );
    process.exit(1);
  }
  const start = Date.now();
  const deleted = await pruneOldAuditLogs(days);
  console.log(
    `audit_log: deleted ${deleted} row(s) older than ${days} day(s) in ${Date.now() - start}ms.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('audit:prune failed', err);
  process.exit(1);
});
