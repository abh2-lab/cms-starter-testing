import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { db, schema } from '@cms/db';
import { env } from '@cms/config';
import {
  decryptWebhookSecret,
  QUEUE_NAMES,
  WebhookDeliverJob,
  WEBHOOK_DELIVER_POLICY,
} from '@cms/queue';

import { jobMeta, type Logger } from '../logger.js';

// Outbound HTTP timeout per attempt. Receivers that take this long are almost
// certainly going to fail — better to retry than block the worker on a slow
// peer for the whole policy backoff window.
const DELIVERY_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_LIMIT = 4_000;

/**
 * Compute the wall-clock timestamp BullMQ will try this job again. Uses the
 * same formula as the policy (`exponential`, 30s base) so the admin UI's
 * "next retry at" column matches what the queue actually does. Returns null
 * when this attempt was the last one and the job is now permanently failed.
 *
 * Exported for tests. Pure — just arithmetic + Date.now().
 */
export function computeNextRetryAt(
  attemptsMade: number,
  maxAttempts: number,
): Date | null {
  if (attemptsMade >= maxAttempts) return null;
  // exponential backoff matches WEBHOOK_DELIVER_POLICY in @cms/queue/policies.ts
  const base = 30_000;
  const delay = base * Math.pow(2, attemptsMade - 1);
  return new Date(Date.now() + delay);
}

export function registerWebhookDeliverWorker(
  connection: Redis,
  log: Logger,
): Worker {
  const worker = new Worker<WebhookDeliverJob>(
    QUEUE_NAMES.webhookDeliver,
    async (job: Job<WebhookDeliverJob>) => {
      const parsed = WebhookDeliverJob.safeParse(job.data);
      if (!parsed.success) {
        throw new UnrecoverableError('malformed webhook-deliver payload');
      }
      const { webhookId, eventName, payload } = parsed.data;
      const childLog = log.child({
        queue: QUEUE_NAMES.webhookDeliver,
        jobId: job.id,
        webhookId,
        eventName,
        ...jobMeta(job.data),
      });

      const [hook] = await db
        .select({
          id: schema.webhooks.id,
          url: schema.webhooks.url,
          isActive: schema.webhooks.isActive,
          secretEncrypted: schema.webhooks.secretEncrypted,
        })
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, webhookId))
        .limit(1);
      if (!hook) {
        // Webhook deleted between enqueue and delivery — no retry will help.
        throw new UnrecoverableError(`webhook ${webhookId} no longer exists`);
      }
      if (!hook.isActive) {
        childLog.info('webhook deactivated; skipping delivery');
        return { skipped: 'inactive' as const };
      }
      if (!hook.secretEncrypted) {
        // Legacy row predating Phase 6 — secret can't be retrieved. Mark a
        // delivery row so the editor sees why, and don't burn retries.
        await db.insert(schema.webhookDeliveries).values({
          webhookId: hook.id,
          eventName,
          payload,
          attemptNumber: 1,
          responseStatus: null,
          responseBody:
            'cannot sign: secret_encrypted is NULL — use the "Rotate secret" button to populate it',
          failedAt: new Date(),
          nextRetryAt: null,
        });
        throw new UnrecoverableError('webhook secret not provisioned');
      }

      const bodyStr = JSON.stringify(payload);
      const secret = decryptWebhookSecret(hook.secretEncrypted);
      const signature = createHmac('sha256', secret)
        .update(bodyStr)
        .digest('hex');
      const deliveryId = String(job.id ?? '');
      const attemptNumber = job.attemptsMade + 1;
      const maxAttempts = WEBHOOK_DELIVER_POLICY.attempts ?? 5;

      let status: number | null = null;
      // No initial value — both try and catch branches assign before respBody
      // is read. `let respBody = null` triggered the no-useless-assignment rule.
      let respBody: string | null;
      let ok = false;
      let networkErr: string | null = null;
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CMS-Event': eventName,
            'X-CMS-Delivery-Id': deliveryId,
            'X-CMS-Signature': `sha256=${signature}`,
          },
          body: bodyStr,
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
        status = res.status;
        respBody = (await res.text()).slice(0, RESPONSE_BODY_LIMIT);
        ok = res.ok;
      } catch (err) {
        networkErr = err instanceof Error ? err.message : 'request failed';
        respBody = networkErr;
      }

      if (ok) {
        await db.insert(schema.webhookDeliveries).values({
          webhookId: hook.id,
          eventName,
          payload,
          attemptNumber,
          responseStatus: status,
          responseBody: respBody,
          deliveredAt: new Date(),
          nextRetryAt: null,
        });
        childLog.info({ status, attemptNumber }, 'delivery succeeded');
        return { ok: true as const, status };
      }

      // Failure path: write the row, then throw so BullMQ retries.
      const nextRetryAt = computeNextRetryAt(attemptNumber, maxAttempts);
      await db.insert(schema.webhookDeliveries).values({
        webhookId: hook.id,
        eventName,
        payload,
        attemptNumber,
        responseStatus: status,
        responseBody: respBody,
        failedAt: new Date(),
        nextRetryAt,
      });
      childLog.warn(
        { status, attemptNumber, maxAttempts, nextRetryAt, networkErr },
        'delivery failed; will retry',
      );
      throw new Error(
        networkErr ?? `webhook responded ${status ?? 'unknown'}`,
      );
    },
    {
      connection,
      concurrency: env.WORKER_WEBHOOK_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    log.warn(
      {
        queue: QUEUE_NAMES.webhookDeliver,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'webhook delivery permanently failed',
    );
  });

  return worker;
}
