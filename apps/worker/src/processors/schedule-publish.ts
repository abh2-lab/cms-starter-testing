import { eq } from 'drizzle-orm';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { db, schema } from '@cms/db';
import { env } from '@cms/config';
import {
  dispatchEvent,
  invalidateContentCache,
  JOB_NAMES,
  type Producers,
  QUEUE_NAMES,
  SchedulePublishJob,
  ScheduleUnpublishJob,
} from '@cms/queue';

import { cacheRedis } from '../lib/redis-cache.js';
import { jobMeta, type Logger } from '../logger.js';

/**
 * schedule-publish worker. Two job kinds:
 *
 *   publish    — content scheduled for future publishAt; flip to 'published'.
 *   unpublish  — content scheduled to come down at unpublishAt; flip to
 *                'archived'.
 *
 * Both are idempotent: the processor re-reads the row, exits OK if the row
 * has been edited out from under it (someone rescheduled, deleted, or
 * cancelled the schedule). Deterministic jobIds (`publish-<contentId>` /
 * `unpublish-<contentId>`) means re-enqueues coalesce.
 *
 * After the DB commit, the processor enqueues a search-index upsert,
 * invalidates the public cache, and dispatches webhooks — same side
 * effects as a manual transition from the admin UI.
 */
export function registerSchedulePublishWorker(
  connection: Redis,
  producers: Producers,
  log: Logger,
): Worker {
  const worker = new Worker(
    QUEUE_NAMES.schedulePublish,
    async (job: Job) => {
      const meta = jobMeta(job.data);
      if (job.name === JOB_NAMES.schedulePublish.publish) {
        const parsed = SchedulePublishJob.safeParse(job.data);
        if (!parsed.success) {
          throw new UnrecoverableError('malformed publish payload');
        }
        return runScheduledTransition({
          mode: 'publish',
          contentId: parsed.data.contentId,
          expectedAtIso: parsed.data.expectedAtIso,
          jobId: job.id,
          producers,
          log,
          ...meta,
        });
      }
      if (job.name === JOB_NAMES.schedulePublish.unpublish) {
        const parsed = ScheduleUnpublishJob.safeParse(job.data);
        if (!parsed.success) {
          throw new UnrecoverableError('malformed unpublish payload');
        }
        return runScheduledTransition({
          mode: 'unpublish',
          contentId: parsed.data.contentId,
          expectedAtIso: parsed.data.expectedAtIso,
          jobId: job.id,
          producers,
          log,
          ...meta,
        });
      }
      throw new UnrecoverableError(`unknown job name: ${job.name}`);
    },
    {
      connection,
      concurrency: env.WORKER_SCHEDULE_PUBLISH_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    log.warn(
      {
        queue: QUEUE_NAMES.schedulePublish,
        jobName: job?.name,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'schedule-publish job failed',
    );
  });

  return worker;
}

interface RunArgs {
  mode: 'publish' | 'unpublish';
  contentId: string;
  expectedAtIso: string;
  jobId: string | undefined;
  producers: Producers;
  log: Logger;
  reqId?: string;
}

async function runScheduledTransition(args: RunArgs): Promise<unknown> {
  const { mode, contentId, expectedAtIso, jobId, producers, log, reqId } =
    args;
  const childLog = log.child({
    queue: QUEUE_NAMES.schedulePublish,
    mode,
    contentId,
    jobId,
    ...(reqId !== undefined ? { reqId } : {}),
  });

  // Re-read + flip in one transaction. SKIP LOCKED would be nicer for
  // concurrent sweeps but Drizzle/postgres-js doesn't expose it cleanly; the
  // unique jobId already prevents two workers picking the same row.
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.content)
      .where(eq(schema.content.id, contentId))
      .for('update')
      .limit(1);
    if (!current) {
      return { kind: 'gone' as const };
    }
    if (mode === 'publish') {
      // Only act if the row is still scheduled with the expected publishAt.
      // If someone rescheduled, deleted, or cancelled, the producer for that
      // change already removed/replaced this job — but BullMQ may have
      // already started it. Bail cleanly.
      if (current.status !== 'scheduled') {
        return { kind: 'stale' as const, reason: 'status not scheduled' };
      }
      if (!current.publishAt) {
        return { kind: 'stale' as const, reason: 'publishAt cleared' };
      }
      if (current.publishAt.toISOString() !== expectedAtIso) {
        return { kind: 'stale' as const, reason: 'publishAt changed' };
      }
    } else {
      // unpublish: act only if currently published AND unpublishAt matches
      if (current.status !== 'published') {
        return { kind: 'stale' as const, reason: 'status not published' };
      }
      if (!current.unpublishAt) {
        return { kind: 'stale' as const, reason: 'unpublishAt cleared' };
      }
      if (current.unpublishAt.toISOString() !== expectedAtIso) {
        return { kind: 'stale' as const, reason: 'unpublishAt changed' };
      }
    }

    const fromStatus = current.status;
    const toStatus = mode === 'publish' ? 'published' : 'archived';
    const updates: Record<string, unknown> = {
      status: toStatus,
      updatedAt: new Date(),
    };
    if (mode === 'publish' && !current.publishedAt) {
      updates['publishedAt'] = new Date();
    }
    const [updated] = await tx
      .update(schema.content)
      .set(updates)
      .where(eq(schema.content.id, contentId))
      .returning();

    if (!updated) return { kind: 'gone' as const };

    await tx.insert(schema.contentStatusTransitions).values({
      contentId,
      fromStatus,
      toStatus,
      // changedBy is nullable — worker-driven transitions have no human actor.
      changedBy: null,
      comment:
        mode === 'publish'
          ? 'auto-published at scheduled publishAt'
          : 'auto-unpublished at scheduled unpublishAt',
    });

    return { kind: 'ok' as const, updated };
  });

  if (result.kind === 'gone') {
    childLog.info('content row no longer exists; nothing to do');
    return { skipped: 'gone' };
  }
  if (result.kind === 'stale') {
    childLog.info({ reason: result.reason }, 'job stale; skipping');
    return { skipped: result.reason };
  }

  const updated = result.updated;
  // Post-commit side effects — exact same set as the admin transition
  // handler. Each is best-effort; the DB write has committed regardless.
  await invalidateContentCache({
    redis: cacheRedis,
    log,
    tenantId: updated.tenantId,
    contentTypeId: updated.contentTypeId,
    contentSlug: updated.slug,
  });
  void producers.searchIndex
    .upsert(updated.id, 'transition')
    .catch((err: unknown) => {
      childLog.warn({ err }, 'enqueue search-index upsert failed');
    });
  void dispatchEvent({
    producers,
    log,
    eventName:
      mode === 'publish' ? 'content.published' : 'content.unpublished',
    payload: {
      id: updated.id,
      slug: updated.slug,
      status: updated.status,
      contentTypeId: updated.contentTypeId,
      autoTransition: true,
    },
    tenantId: updated.tenantId,
  });
  childLog.info(
    { newStatus: updated.status },
    `${mode} job completed`,
  );
  return { ok: true };
}
