import * as Sentry from '@sentry/node';
import type { Job, Worker } from 'bullmq';
import { env } from '@cms/config';

let enabled = false;

/**
 * Initialise Sentry for the worker process. Mirrors the API init; same DSN
 * value applies because Glitchtip / Sentry project scope is per-deploy, not
 * per-service. Safe to call multiple times; complete no-op when DSN is empty.
 */
export function initSentry(): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  });
  enabled = true;
}

/**
 * Attach a `failed` listener that mirrors BullMQ's logged failure into Sentry
 * with the job context as tags. Called once per registered Worker. No-op
 * when Sentry isn't initialised so worker boot in dev pays nothing.
 *
 * The existing per-worker `log.warn('job failed', ...)` stays — Sentry is an
 * additional sink for the alerting workflow, not a replacement for the
 * structured log stream that operators grep.
 */
export function attachWorkerSentry(worker: Worker): void {
  if (!enabled) return;
  worker.on('failed', (job: Job | undefined, err: Error) => {
    const reqId =
      job?.data && typeof job.data === 'object' && 'reqId' in job.data
        ? (job.data as { reqId?: unknown }).reqId
        : undefined;
    Sentry.withScope((scope) => {
      scope.setTag('queue', worker.name);
      if (job?.id) scope.setTag('job_id', job.id);
      if (job?.name) scope.setTag('job_name', job.name);
      if (job?.attemptsMade !== undefined) {
        scope.setExtra('attempts_made', job.attemptsMade);
      }
      if (typeof reqId === 'string') scope.setTag('req_id', reqId);
      Sentry.captureException(err);
    });
  });
}

export function sentryEnabled(): boolean {
  return enabled;
}

/**
 * Best-effort flush on shutdown. Sentry buffers events client-side; without
 * this, a fast SIGTERM can drop the last few seconds of failures.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Swallow — shutdown must not block on the error tracker.
  }
}
