import type { Job, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { createQueueRedis } from '@cms/queue';

export function createTestRedis(): Redis {
  return createQueueRedis();
}

/**
 * Pull the BullMQ id off whatever a producer method returned. The Producers
 * interface widens the return to `unknown` (Bull Board is the only intended
 * consumer of the concrete Job), so tests need a tiny coercion helper.
 */
export function jobIdOf(value: unknown): string {
  const j = value as { id?: string | number | null };
  if (j == null || j.id == null) {
    throw new Error('producer returned no job id');
  }
  return String(j.id);
}

export type JobOutcome =
  | { ok: true; returnvalue: unknown }
  | { ok: false; reason: string };

/**
 * Wait for a BullMQ job (by id) to finish via worker events. Returns the
 * outcome rather than throwing so tests can assert on either path without a
 * try/catch wrapper. Times out after `timeoutMs` so a stuck job doesn't hang
 * the whole suite.
 */
export async function waitForJob(
  worker: Worker,
  jobId: string,
  timeoutMs = 15_000,
): Promise<JobOutcome> {
  return new Promise<JobOutcome>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, reason: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    const onCompleted = (job: Job): void => {
      if (job.id === jobId) {
        cleanup();
        resolve({ ok: true, returnvalue: job.returnvalue });
      }
    };
    const onFailed = (job: Job | undefined, err: Error): void => {
      if (job?.id === jobId) {
        cleanup();
        resolve({ ok: false, reason: err.message });
      }
    };
    function cleanup(): void {
      clearTimeout(timer);
      worker.off('completed', onCompleted);
      worker.off('failed', onFailed);
    }
    worker.on('completed', onCompleted);
    worker.on('failed', onFailed);
  });
}

/**
 * Poll a predicate until it returns truthy or the deadline passes. Returns
 * the truthy value or null. Useful for chained side effects whose job id is
 * non-deterministic from the test's POV (e.g. the search-index upsert that
 * the schedule-publish processor enqueues).
 */
export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 5_000,
  intervalMs = 100,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
