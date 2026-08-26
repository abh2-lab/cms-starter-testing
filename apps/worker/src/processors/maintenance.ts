import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { db, schema } from '@cms/db';
import { JOB_NAMES, type Producers, QUEUE_NAMES } from '@cms/queue';
import { reindexAllContent } from '@cms/search';

import { jobMeta, type Logger } from '../logger.js';
import { runUpdateCheck } from '../lib/update-check.js';

/**
 * Maintenance worker — handles repeatable sweep jobs that backstop the rest
 * of the system. Cheap to run, idempotent, and the safety net for cases
 * where a delayed job got lost (Dragonfly persistence is in-memory by
 * default — a crash before snapshot loses queued jobs).
 *
 * Jobs:
 *   scheduled-publish-sweep — hourly. Scans content rows due to (un)publish
 *     in the next hour and re-enqueues delayed publish/unpublish jobs.
 *     Deterministic jobIds make this a no-op when the per-row job already
 *     exists from the producer hook at write time.
 *   meili-drift-sweep — daily. Stub for Phase 6 step 9 (Meili drift cron
 *     migration); currently logs and exits.
 */
export function registerMaintenanceWorker(
  connection: Redis,
  producers: Producers,
  log: Logger,
): Worker {
  const worker = new Worker(
    QUEUE_NAMES.maintenance,
    async (job: Job) => {
      const sweepLog = log.child({
        queue: QUEUE_NAMES.maintenance,
        jobName: job.name,
        jobId: job.id,
        ...jobMeta(job.data),
      });
      if (job.name === JOB_NAMES.maintenance.schedulePublishSweep) {
        return runSchedulePublishSweep(producers, sweepLog);
      }
      if (job.name === JOB_NAMES.maintenance.meiliDriftSweep) {
        const start = Date.now();
        const r = await reindexAllContent();
        sweepLog.info(
          {
            scanned: r.scanned,
            indexed: r.indexed,
            skipped: r.skipped,
            errors: r.errors,
            durationMs: Date.now() - start,
          },
          'meili-drift-sweep completed',
        );
        return r;
      }
      if (job.name === JOB_NAMES.maintenance.updateCheck) {
        // runUpdateCheck never throws — a release host being down records the
        // error on update_status and returns normally, so a flaky endpoint
        // can't retry-storm or mark the sweep failed.
        return runUpdateCheck(sweepLog);
      }
      throw new UnrecoverableError(`unknown maintenance job: ${job.name}`);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.warn(
      {
        queue: QUEUE_NAMES.maintenance,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'maintenance job failed',
    );
  });

  return worker;
}

async function runSchedulePublishSweep(
  producers: Producers,
  log: Logger,
): Promise<{ publishes: number; unpublishes: number }> {
  // Window: due within the next hour, not stale beyond 7 days. The upper
  // bound keeps the per-tick scan bounded; the lower bound declines to
  // resurrect very-overdue rows whose schedule was likely cancelled but
  // whose job vanished from Dragonfly — operators can re-trigger manually.
  const upperExpr = sql`now() + interval '1 hour'`;
  const lowerExpr = sql`now() - interval '7 days'`;

  const publishCandidates = await db
    .select({
      id: schema.content.id,
      publishAt: schema.content.publishAt,
    })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.status, 'scheduled'),
        isNotNull(schema.content.publishAt),
        lte(schema.content.publishAt, upperExpr),
        gte(schema.content.publishAt, lowerExpr),
      ),
    );

  let publishes = 0;
  for (const row of publishCandidates) {
    if (!row.publishAt) continue;
    try {
      // Deterministic jobId — BullMQ no-ops when one exists for this id.
      await producers.schedule.publishAt(row.id, row.publishAt);
      publishes++;
    } catch (err) {
      log.warn(
        { err, contentId: row.id },
        'sweep: failed to enqueue publish',
      );
    }
  }

  const unpublishCandidates = await db
    .select({
      id: schema.content.id,
      unpublishAt: schema.content.unpublishAt,
    })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.status, 'published'),
        isNotNull(schema.content.unpublishAt),
        lte(schema.content.unpublishAt, upperExpr),
        gte(schema.content.unpublishAt, lowerExpr),
      ),
    );

  let unpublishes = 0;
  for (const row of unpublishCandidates) {
    if (!row.unpublishAt) continue;
    try {
      await producers.schedule.unpublishAt(row.id, row.unpublishAt);
      unpublishes++;
    } catch (err) {
      log.warn(
        { err, contentId: row.id },
        'sweep: failed to enqueue unpublish',
      );
    }
  }

  // Sweep summary — wall-clock time is good enough; the raw SQL expression
  // doesn't stringify usefully and pino captures the log timestamp anyway.
  log.info(
    { publishes, unpublishes, sweptAt: new Date().toISOString() },
    'scheduled-publish-sweep completed',
  );
  return { publishes, unpublishes };
}
