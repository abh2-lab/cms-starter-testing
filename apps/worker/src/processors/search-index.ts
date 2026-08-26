import { UnrecoverableError, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { env } from '@cms/config';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  SearchIndexRemoveJob,
  SearchIndexUpsertJob,
} from '@cms/queue';
import {
  removeContentFromIndexStrict,
  upsertContentByIdStrict,
} from '@cms/search';

import { jobMeta, type Logger } from '../logger.js';

/**
 * search-index worker — handles `upsert` and `remove` jobs. Each is a thin
 * shell around the strict (throw-on-error) variants from @cms/search; that
 * way BullMQ sees real failures and retries with exponential backoff. The
 * fail-open versions still live in @cms/search for any sync callsite that
 * intentionally doesn't want retries.
 *
 * Concurrency is env-tunable (default 8 — Meili and Postgres can handle far
 * more, but a single-install deployment rarely needs more than this).
 */
export function registerSearchIndexWorker(
  connection: Redis,
  log: Logger,
): Worker {
  const worker = new Worker(
    QUEUE_NAMES.searchIndex,
    async (job) => {
      const childLog = log.child({
        queue: QUEUE_NAMES.searchIndex,
        jobName: job.name,
        jobId: job.id,
        ...jobMeta(job.data),
      });

      if (job.name === JOB_NAMES.searchIndex.upsert) {
        const parsed = SearchIndexUpsertJob.safeParse(job.data);
        if (!parsed.success) {
          childLog.error(
            { issues: parsed.error.issues },
            'malformed upsert payload',
          );
          // Bad payload is unrecoverable — retrying won't help. BullMQ marks
          // the job failed immediately without burning attempts.
          throw new UnrecoverableError('malformed upsert payload');
        }
        childLog.debug({ contentId: parsed.data.contentId }, 'indexing');
        await upsertContentByIdStrict(parsed.data.contentId);
        return;
      }

      if (job.name === JOB_NAMES.searchIndex.remove) {
        const parsed = SearchIndexRemoveJob.safeParse(job.data);
        if (!parsed.success) {
          childLog.error(
            { issues: parsed.error.issues },
            'malformed remove payload',
          );
          throw new UnrecoverableError('malformed remove payload');
        }
        childLog.debug({ contentId: parsed.data.contentId }, 'removing');
        await removeContentFromIndexStrict(parsed.data.contentId);
        return;
      }

      childLog.error('unknown job name');
      throw new UnrecoverableError(`unknown job name: ${job.name}`);
    },
    {
      connection,
      concurrency: env.WORKER_SEARCH_INDEX_CONCURRENCY,
    },
  );

  worker.on('completed', (job) => {
    log.info(
      {
        queue: QUEUE_NAMES.searchIndex,
        jobName: job.name,
        jobId: job.id,
        durationMs:
          job.finishedOn && job.processedOn
            ? job.finishedOn - job.processedOn
            : null,
      },
      'job completed',
    );
  });

  worker.on('failed', (job, err) => {
    log.warn(
      {
        queue: QUEUE_NAMES.searchIndex,
        jobName: job?.name,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'job failed',
    );
  });

  return worker;
}
