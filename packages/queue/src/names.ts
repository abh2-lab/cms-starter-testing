/**
 * Single source of truth for queue + job names. Producer (apps/api) and
 * consumer (apps/worker) import from here so the strings can never drift.
 */

export const QUEUE_NAMES = {
  searchIndex: 'search-index',
  webhookDeliver: 'webhook-deliver',
  schedulePublish: 'schedule-publish',
  imageProcess: 'image-process',
  emailSend: 'email-send',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Job names per queue (BullMQ requires a name per Queue.add() call).
export const JOB_NAMES = {
  searchIndex: {
    upsert: 'upsert',
    remove: 'remove',
  },
  webhookDeliver: {
    deliver: 'deliver',
  },
  schedulePublish: {
    publish: 'publish',
    unpublish: 'unpublish',
  },
  imageProcess: {
    generateVariants: 'generate-variants',
  },
  emailSend: {
    send: 'send',
  },
  maintenance: {
    schedulePublishSweep: 'scheduled-publish-sweep',
    meiliDriftSweep: 'meili-drift-sweep',
    // Daily release-manifest poll. Also enqueued on demand when an operator
    // hits "check now" in the admin — the worker owns the only implementation
    // so the API never duplicates the fetch/compare logic.
    updateCheck: 'update-check',
  },
} as const;
