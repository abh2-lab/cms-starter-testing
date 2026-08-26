import type { JobsOptions } from 'bullmq';

/**
 * Per-queue default job options. Tuned conservatively for a single-install
 * news CMS — bumps to attempts/backoff want a deliberate review since they
 * change retry budget visible to operators in Bull Board.
 *
 * removeOnComplete / removeOnFail keeps the queue from growing unboundedly.
 * Use `age` (seconds) for time-based eviction; `count` caps the in-memory
 * history Bull Board displays.
 */

export const SEARCH_INDEX_POLICY: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 86_400 * 7 },
};

export const WEBHOOK_DELIVER_POLICY: JobsOptions = {
  attempts: 5,
  // Webhook receivers are external — give them a generous gap. Exponential
  // from 30s climbs 30→60→120→240→480s ≈ 16 minutes total exposure.
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400 * 14 },
};

export const SCHEDULE_PUBLISH_POLICY: JobsOptions = {
  attempts: 3,
  backoff: { type: 'fixed', delay: 5_000 },
  removeOnComplete: { age: 600 },
  removeOnFail: { age: 86_400 * 30 },
};

export const IMAGE_PROCESS_POLICY: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 1_800, count: 200 },
  removeOnFail: { age: 86_400 * 7 },
};

export const EMAIL_SEND_POLICY: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 86_400 * 14 },
};

export const MAINTENANCE_POLICY: JobsOptions = {
  attempts: 1,
  removeOnComplete: { count: 30 },
  removeOnFail: { count: 60 },
};
