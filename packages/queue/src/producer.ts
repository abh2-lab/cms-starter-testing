import { Queue, type JobsOptions } from 'bullmq';
import type Redis from 'ioredis';

import { JOB_NAMES, QUEUE_NAMES } from './names.js';
import {
  EMAIL_SEND_POLICY,
  IMAGE_PROCESS_POLICY,
  MAINTENANCE_POLICY,
  SCHEDULE_PUBLISH_POLICY,
  SEARCH_INDEX_POLICY,
  WEBHOOK_DELIVER_POLICY,
} from './policies.js';
import type {
  EmailSendJob,
  ImageProcessJob,
  SchedulePublishJob,
  ScheduleUnpublishJob,
  SearchIndexRemoveJob,
  SearchIndexUpsertJob,
  WebhookDeliverJob,
} from './types.js';

export interface Producers {
  /**
   * Raw Queue instances — exposed only so Bull Board can enumerate them.
   * Callers should prefer the typed helpers below.
   */
  rawQueues: Queue[];

  searchIndex: {
    upsert: (
      contentId: string,
      reason: SearchIndexUpsertJob['reason'],
      reqId?: string,
    ) => Promise<unknown>;
    remove: (contentId: string, reqId?: string) => Promise<unknown>;
  };

  webhooks: {
    deliver: (job: WebhookDeliverJob) => Promise<unknown>;
  };

  schedule: {
    /**
     * Enqueue (or replace) the auto-publish job for a content row. Using a
     * deterministic jobId means re-enqueues coalesce — late edits to
     * publishAt overwrite the earlier delayed job rather than stacking.
     */
    publishAt: (contentId: string, at: Date, reqId?: string) => Promise<unknown>;
    unpublishAt: (
      contentId: string,
      at: Date,
      reqId?: string,
    ) => Promise<unknown>;
    /** Cancel any pending publish/unpublish for this content id. No-op if absent. */
    cancelPublish: (contentId: string) => Promise<unknown>;
    cancelUnpublish: (contentId: string) => Promise<unknown>;
  };

  images: {
    generateVariants: (job: ImageProcessJob) => Promise<unknown>;
  };

  email: {
    send: (job: EmailSendJob) => Promise<unknown>;
  };

  /** Close every underlying Queue connection. Call from onClose hooks. */
  close: () => Promise<void>;
}

// BullMQ disallows `:` in custom job ids — it would collide with the Redis
// key separator they use internally. `-` reads cleanly in Bull Board.
const publishJobId = (contentId: string): string => `publish-${contentId}`;
const unpublishJobId = (contentId: string): string => `unpublish-${contentId}`;
// Upserts vary the jobId by reason + monotonic timestamp. SEARCH_INDEX_POLICY
// keeps completed jobs around for an hour for observability, and BullMQ
// silently dedupes new jobs against any same-id completed entry — so a fixed
// `upsert-<contentId>` was discarding the publish-transition reindex against
// the create-time entry, leaving the Meili doc stuck at status:draft. Suffixing
// with reason+timestamp lets each distinct event get its own job while still
// deduping concurrent identical events fired within the same millisecond.
const upsertJobId = (contentId: string, reason: string): string =>
  `upsert-${contentId}-${reason}-${Date.now()}`;
const removeJobId = (contentId: string): string => `remove-${contentId}`;

/**
 * Build the typed producer surface against an existing Redis connection.
 * Both the API (producer) and the worker (which also publishes follow-up
 * jobs from inside processors) call this once at startup.
 */
export function createProducers(connection: Redis): Producers {
  const searchIndexQueue = new Queue<
    SearchIndexUpsertJob | SearchIndexRemoveJob
  >(QUEUE_NAMES.searchIndex, {
    connection,
    defaultJobOptions: SEARCH_INDEX_POLICY,
  });

  const webhookQueue = new Queue<WebhookDeliverJob>(QUEUE_NAMES.webhookDeliver, {
    connection,
    defaultJobOptions: WEBHOOK_DELIVER_POLICY,
  });

  const scheduleQueue = new Queue<SchedulePublishJob | ScheduleUnpublishJob>(
    QUEUE_NAMES.schedulePublish,
    {
      connection,
      defaultJobOptions: SCHEDULE_PUBLISH_POLICY,
    },
  );

  const imageQueue = new Queue<ImageProcessJob>(QUEUE_NAMES.imageProcess, {
    connection,
    defaultJobOptions: IMAGE_PROCESS_POLICY,
  });

  const emailQueue = new Queue<EmailSendJob>(QUEUE_NAMES.emailSend, {
    connection,
    defaultJobOptions: EMAIL_SEND_POLICY,
  });

  const maintenanceQueue = new Queue(QUEUE_NAMES.maintenance, {
    connection,
    defaultJobOptions: MAINTENANCE_POLICY,
  });

  const rawQueues: Queue[] = [
    searchIndexQueue,
    webhookQueue,
    scheduleQueue,
    imageQueue,
    emailQueue,
    maintenanceQueue,
  ];

  return {
    rawQueues,

    searchIndex: {
      upsert: (contentId, reason, reqId) =>
        searchIndexQueue.add(
          JOB_NAMES.searchIndex.upsert,
          { contentId, reason, ...(reqId !== undefined ? { reqId } : {}) },
          { jobId: upsertJobId(contentId, reason) },
        ),
      remove: (contentId, reqId) =>
        searchIndexQueue.add(
          JOB_NAMES.searchIndex.remove,
          { contentId, ...(reqId !== undefined ? { reqId } : {}) },
          { jobId: removeJobId(contentId) },
        ),
    },

    webhooks: {
      deliver: (job) =>
        webhookQueue.add(JOB_NAMES.webhookDeliver.deliver, job),
    },

    schedule: {
      publishAt: (contentId, at, reqId) => {
        const delay = Math.max(0, at.getTime() - Date.now());
        const opts: JobsOptions = {
          delay,
          jobId: publishJobId(contentId),
        };
        return scheduleQueue.add(
          JOB_NAMES.schedulePublish.publish,
          {
            contentId,
            expectedAtIso: at.toISOString(),
            ...(reqId !== undefined ? { reqId } : {}),
          },
          opts,
        );
      },
      unpublishAt: (contentId, at, reqId) => {
        const delay = Math.max(0, at.getTime() - Date.now());
        const opts: JobsOptions = {
          delay,
          jobId: unpublishJobId(contentId),
        };
        return scheduleQueue.add(
          JOB_NAMES.schedulePublish.unpublish,
          {
            contentId,
            expectedAtIso: at.toISOString(),
            ...(reqId !== undefined ? { reqId } : {}),
          },
          opts,
        );
      },
      cancelPublish: (contentId) =>
        scheduleQueue.remove(publishJobId(contentId)),
      cancelUnpublish: (contentId) =>
        scheduleQueue.remove(unpublishJobId(contentId)),
    },

    images: {
      generateVariants: (job) =>
        imageQueue.add(JOB_NAMES.imageProcess.generateVariants, job),
    },

    email: {
      send: (job) => emailQueue.add(JOB_NAMES.emailSend.send, job),
    },

    close: async () => {
      await Promise.allSettled(rawQueues.map((q) => q.close()));
    },
  };
}
