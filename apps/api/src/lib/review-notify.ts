import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, schema } from '@cms/db';

import { producers } from './queue.js';

// Whether a given notification toggle is on for the tenant. Defaults to ON when
// no email_settings row exists yet (matches the column defaults), so behaviour
// is unchanged until a publisher opts out in Settings → Email.
async function notifyFlagEnabled(
  tenantId: string | null,
  flag: 'notifyOnReview' | 'notifyOnApproval' | 'notifyOnReaderSubmission',
  defaultWhenMissing = true,
): Promise<boolean> {
  const where =
    tenantId === null
      ? isNull(schema.emailSettings.tenantId)
      : eq(schema.emailSettings.tenantId, tenantId);
  const [row] = await db
    .select({ value: schema.emailSettings[flag] })
    .from(schema.emailSettings)
    .where(where)
    .limit(1);
  return row ? row.value : defaultWhenMissing;
}

/**
 * Enqueue an email to every editor+ user in this tenant. Used when a draft
 * is sent for review. `actorId` is excluded — the author doesn't email
 * themselves a "please review your own work" notice.
 */
export async function notifyReviewers(args: {
  log: FastifyBaseLogger;
  tenantId: string;
  actorId: string;
  actorDisplayName: string;
  contentId: string;
  contentTitle: string;
  comment: string | null;
  reqId?: string;
}): Promise<void> {
  try {
    // Respect the publisher's "Article submitted for review" toggle.
    if (!(await notifyFlagEnabled(args.tenantId, 'notifyOnReview'))) return;
    // Roles >= editor: editor, admin, super_admin. Super_admins with
    // tenantId = NULL are excluded — they're cross-tenant and don't expect
    // per-tenant review notifications.
    const reviewers = await db
      .select({ email: schema.adminUsers.email })
      .from(schema.adminUsers)
      .where(
        and(
          eq(schema.adminUsers.tenantId, args.tenantId),
          eq(schema.adminUsers.isActive, true),
          inArray(schema.adminUsers.role, ['editor', 'admin', 'super_admin']),
          sql`${schema.adminUsers.id} <> ${args.actorId}`,
        ),
      );
    for (const r of reviewers) {
      void producers.email
        .send({
          kind: 'review_requested',
          to: r.email,
          tenantId: args.tenantId,
          context: {
            contentId: args.contentId,
            contentTitle: args.contentTitle,
            actorDisplayName: args.actorDisplayName,
            comment: args.comment,
          },
          ...(args.reqId !== undefined ? { reqId: args.reqId } : {}),
        })
        .catch((err: unknown) => {
          args.log.warn(
            { err, to: r.email },
            'enqueue review_requested email failed',
          );
        });
    }
  } catch (err) {
    args.log.warn({ err }, 'reviewer lookup failed');
  }
}

/**
 * Notify the author of a content row that the review outcome was reached.
 * `kind` distinguishes approved (published or approved status) from
 * rejected (sent back to draft). Skips silently when the row has no
 * author (legacy / system-generated content).
 */
export async function notifyAuthor(args: {
  log: FastifyBaseLogger;
  tenantId: string | null;
  authorId: string | null;
  actorDisplayName: string;
  kind: 'review_approved' | 'review_rejected';
  contentId: string;
  contentTitle: string;
  comment: string | null;
  reqId?: string;
}): Promise<void> {
  if (!args.authorId) return;
  try {
    // Respect the publisher's "Article approved or rejected" toggle.
    if (!(await notifyFlagEnabled(args.tenantId, 'notifyOnApproval'))) return;
    const [author] = await db
      .select({
        email: schema.adminUsers.email,
        isActive: schema.adminUsers.isActive,
      })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.id, args.authorId))
      .limit(1);
    if (!author || !author.isActive) return;
    void producers.email
      .send({
        kind: args.kind,
        to: author.email,
        tenantId: args.tenantId,
        context: {
          contentId: args.contentId,
          contentTitle: args.contentTitle,
          actorDisplayName: args.actorDisplayName,
          comment: args.comment,
        },
        ...(args.reqId !== undefined ? { reqId: args.reqId } : {}),
      })
      .catch((err: unknown) => {
        args.log.warn(
          { err, to: author.email },
          `enqueue ${args.kind} email failed`,
        );
      });
  } catch (err) {
    args.log.warn({ err }, 'author lookup failed');
  }
}

/**
 * Enqueue an email to every editor+ user in this tenant when a reader (guest or
 * logged-in) submits content via the public submission endpoint. Gated on the
 * tenant's `notifyOnReaderSubmission` setting, which defaults OFF — a publisher
 * opts in under Settings → Email before these notifications start sending.
 * Reuses the EmailSendJob `context`: actorDisplayName = submitter name,
 * comment = submitter email.
 */
export async function notifyReaderSubmission(args: {
  log: FastifyBaseLogger;
  tenantId: string;
  contentId: string;
  contentTitle: string;
  submitterName: string;
  submitterEmail: string;
  reqId?: string;
}): Promise<void> {
  try {
    // Default OFF — reader-submission notices are opt-in (column default false).
    if (
      !(await notifyFlagEnabled(
        args.tenantId,
        'notifyOnReaderSubmission',
        false,
      ))
    ) {
      return;
    }
    const reviewers = await db
      .select({ email: schema.adminUsers.email })
      .from(schema.adminUsers)
      .where(
        and(
          eq(schema.adminUsers.tenantId, args.tenantId),
          eq(schema.adminUsers.isActive, true),
          inArray(schema.adminUsers.role, ['editor', 'admin', 'super_admin']),
        ),
      );
    for (const r of reviewers) {
      void producers.email
        .send({
          kind: 'reader_submission',
          to: r.email,
          tenantId: args.tenantId,
          context: {
            contentId: args.contentId,
            contentTitle: args.contentTitle,
            actorDisplayName: args.submitterName,
            comment: args.submitterEmail,
          },
          ...(args.reqId !== undefined ? { reqId: args.reqId } : {}),
        })
        .catch((err: unknown) => {
          args.log.warn(
            { err, to: r.email },
            'enqueue reader_submission email failed',
          );
        });
    }
  } catch (err) {
    args.log.warn({ err }, 'reader-submission reviewer lookup failed');
  }
}
