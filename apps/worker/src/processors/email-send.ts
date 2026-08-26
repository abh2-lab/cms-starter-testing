import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { env } from '@cms/config';
import { readSiteUrl } from '@cms/db';
import {
  buildTransport,
  resolveEmailConfig,
  type EmailTransport,
} from '@cms/email';
import { EmailSendJob, QUEUE_NAMES } from '@cms/queue';

import { renderEmail } from '../lib/email/templates.js';
import { jobMeta, type Logger } from '../logger.js';

/**
 * email-send worker — resolves the per-tenant transport from email_settings
 * (DB-configured via the admin UI), renders the body from the job's `kind`,
 * and sends. Failures throw so BullMQ retries with EMAIL_SEND_POLICY backoff.
 *
 * Transports are cached per tenant and rebuilt only when that tenant's
 * email_settings changes (`version` = the row's updatedAt), so nodemailer's
 * SMTP connection pool is reused across jobs. A `transportOverride` short-
 * circuits resolution entirely (used by tests).
 */
export interface EmailWorkerHandle {
  worker: Worker;
  closeTransport: () => Promise<void>;
}

export function registerEmailSendWorker(
  connection: Redis,
  log: Logger,
  transportOverride?: EmailTransport,
): EmailWorkerHandle {
  const cache = new Map<
    string,
    { version: number; transport: EmailTransport }
  >();

  async function transportFor(
    tenantId: string | null,
  ): Promise<EmailTransport> {
    if (transportOverride) return transportOverride;
    const key = tenantId ?? '__null__';
    const { config, version } = await resolveEmailConfig({ tenantId });
    const cached = cache.get(key);
    if (cached && cached.version === version) return cached.transport;
    // Settings changed (or first use) — drop the stale pooled transport.
    if (cached) await cached.transport.close().catch(() => undefined);
    const transport = buildTransport(config, log);
    cache.set(key, { version, transport });
    return transport;
  }

  const worker = new Worker<EmailSendJob>(
    QUEUE_NAMES.emailSend,
    async (job: Job<EmailSendJob>) => {
      const parsed = EmailSendJob.safeParse(job.data);
      if (!parsed.success) {
        throw new UnrecoverableError('malformed email-send payload');
      }
      const transport = await transportFor(parsed.data.tenantId ?? null);
      // siteUrl drives the "Open it in the editor" link in the email body.
      // Null is acceptable — renderEmail degrades to text directions.
      const siteUrl = await readSiteUrl(parsed.data.tenantId ?? null);
      const msg = renderEmail(parsed.data, siteUrl);
      const result = await transport.send(msg);
      log.info(
        {
          queue: QUEUE_NAMES.emailSend,
          jobId: job.id,
          kind: parsed.data.kind,
          to: parsed.data.to,
          messageId: result.messageId,
          ...jobMeta(job.data),
        },
        'email sent',
      );
      return result;
    },
    {
      connection,
      concurrency: env.WORKER_EMAIL_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    log.warn(
      {
        queue: QUEUE_NAMES.emailSend,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'email-send job failed',
    );
  });

  return {
    worker,
    closeTransport: async () => {
      if (transportOverride) {
        await transportOverride.close();
        return;
      }
      await Promise.all(
        [...cache.values()].map((c) =>
          c.transport.close().catch(() => undefined),
        ),
      );
      cache.clear();
    },
  };
}
