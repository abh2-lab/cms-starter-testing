import { randomUUID } from 'node:crypto';
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import { stripHtml, stripHtmlInline } from '../../lib/sanitize.js';
import { logAudit } from '../../lib/audit.js';
import { producers } from '../../lib/queue.js';
import { notifyReaderSubmission } from '../../lib/review-notify.js';
import { lookupAdminSession } from '../../services/session.js';
import { SESSION_COOKIE_NAME } from '../admin/auth.js';
import { getRateLimitRedis } from '../../lib/rate-limit-redis.js';

// The logged-in submitter, if any. Resolved once in the rate-limit preHandler
// and reused by the handler so we only hit the session store once per request.
interface SubmissionActor {
  userId: string;
  role: string;
  tenantId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    submissionActor?: SubmissionActor | null;
  }
}

// Per-IP (guest) vs per-user (authenticated) hourly caps. Logged-in users are
// known, so they get a higher allowance.
const GUEST_MAX_PER_HOUR = 5;
const AUTHED_MAX_PER_HOUR = 20;
const WINDOW_SECONDS = 60 * 60;

// Reject extra keys (e.g. an attempt to set `status` or `slug`) with a 400 —
// status is hardcoded to 'draft' server-side and never read from the body.
const SubmissionBody = z
  .object({
    title: z.string().min(1).max(500),
    // Legacy single "message" body — optional now that forms can send named
    // fields instead (the /contact form still uses it; the portfolio card sends
    // `fields`).
    body: z.string().min(1).max(20000).optional(),
    submitter_name: z.string().min(1).max(200),
    submitter_email: z.string().email().max(320),
    // Named form fields, keyed by the content type's field names. Each is stored
    // on the submission under its key, so the admin "information" table shows one
    // column per field. Values capped; HTML stripped on store.
    fields: z
      .record(z.string().min(1).max(100), z.string().max(20000))
      .optional(),
    content_type_slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9-]*$/),
  })
  .strict();

// Resolve the admin session cookie if present, WITHOUT rejecting when absent —
// public submissions are anonymous by default. Returns null for guests.
async function resolveOptionalActor(
  request: FastifyRequest,
): Promise<SubmissionActor | null> {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  try {
    const lookup = await lookupAdminSession(token);
    if (!lookup) return null;
    return {
      userId: lookup.user.id,
      role: lookup.user.role,
      tenantId: lookup.user.tenantId,
    };
  } catch {
    // A session-store hiccup shouldn't 500 a public submit — treat as guest.
    return null;
  }
}

// Tiered rate limit on the same Dragonfly store the public rate-limit plugin
// uses (getRateLimitRedis). Fails OPEN on a cache outage, mirroring the
// plugin's skipOnError so a Dragonfly blip can't take submissions offline.
async function submissionRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = await resolveOptionalActor(request);
  request.submissionActor = actor;

  const max = actor ? AUTHED_MAX_PER_HOUR : GUEST_MAX_PER_HOUR;
  const bucket = actor ? `user:${actor.userId}` : `ip:${request.ip}`;
  const key = `ratelimit:submission:${bucket}`;

  let count: number;
  try {
    const redis = getRateLimitRedis();
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SECONDS);
  } catch (err) {
    request.log.warn({ err }, 'submission rate-limit check failed; allowing');
    return;
  }
  if (count > max) {
    await reply
      .code(429)
      .send({ error: 'Too many submissions. Please try again later.' });
  }
}

function generateUniqueSlug(title: string): string {
  const stem =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'submission';
  return `${stem}-${randomUUID().slice(0, 8)}`;
}

function isSlugConflict(e: unknown): boolean {
  return (
    e instanceof Error && e.message.includes('content_tenant_type_slug_uniq')
  );
}

/**
 * Anonymous public content submission. Creates a `draft` content row that
 * editors review and publish from the admin. Never exposes the created id or
 * any DB detail. Access is gated per content type via `submission_access`:
 * none → 403, authenticated → 401 for guests, public → anyone.
 */
export const publicSubmissionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/',
    { preHandler: submissionRateLimit },
    async (request, reply) => {
      const parsed = SubmissionBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid submission.' });
      }

      // Spam/XSS hardening: strip HTML from every string before it is stored.
      // Body keeps line breaks; single-line fields are flattened.
      const title = stripHtmlInline(parsed.data.title);
      const body = parsed.data.body ? stripHtml(parsed.data.body) : '';
      const submitterName = stripHtmlInline(parsed.data.submitter_name);
      const submitterEmail = stripHtmlInline(parsed.data.submitter_email);
      // Named form fields → stored under their own keys so the admin table shows
      // one column per field. Single-line-flattened + HTML-stripped.
      const namedFields: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.data.fields ?? {})) {
        namedFields[k] = stripHtmlInline(v);
      }
      if (!title || !submitterName) {
        return reply
          .code(400)
          .send({ error: 'Your name and a subject are required.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitterEmail)) {
        return reply.code(400).send({ error: 'A valid email is required.' });
      }

      const tenantId = await resolvePublicTenantId();

      // Find the target content type in the public tenant and read its access.
      const [contentType] = await db
        .select({
          id: schema.contentTypes.id,
          submissionAccess: schema.contentTypes.submissionAccess,
        })
        .from(schema.contentTypes)
        .where(
          and(
            eq(schema.contentTypes.slug, parsed.data.content_type_slug),
            eq(schema.contentTypes.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!contentType) {
        return reply.code(404).send({ error: 'Unknown content type.' });
      }

      const actor = request.submissionActor ?? null;
      switch (contentType.submissionAccess) {
        case 'none':
          return reply
            .code(403)
            .send({ error: 'Submissions are closed for this content type.' });
        case 'authenticated':
          if (!actor) {
            return reply
              .code(401)
              .send({ error: 'Please sign in to submit this content type.' });
          }
          break;
        case 'public':
        default:
          break;
      }

      // Insert the draft + audit inside one transaction; retry once if the
      // random slug somehow collides. Search-index + email fire after commit.
      let created: { id: string; title: string } | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const slug = generateUniqueSlug(title);
        try {
          created = await db.transaction(async (tx) => {
            const [row] = await tx
              .insert(schema.content)
              .values({
                tenantId,
                contentTypeId: contentType.id,
                title,
                slug,
                status: 'draft', // hardcoded — readers never set status
                authorId: actor?.userId ?? null,
                customFields: {
                  // Form's named fields first; the fixed provenance keys below
                  // always win over a same-named form field.
                  ...namedFields,
                  submission_body: body,
                  submitter_name: submitterName,
                  submitter_email: submitterEmail,
                  submitter_user_id: actor?.userId ?? null,
                  submitter_role: actor?.role ?? null,
                },
              })
              .returning({
                id: schema.content.id,
                title: schema.content.title,
              });
            if (!row) throw new Error('content insert returned no row');
            await logAudit({
              tx,
              tenantId,
              actorId: actor?.userId ?? null,
              actorType: actor ? 'admin' : 'system',
              action: 'content.submitted',
              resourceType: 'content',
              resourceId: row.id,
              afterSnapshot: { title: row.title },
              metadata: { submitterEmail, guest: actor === null },
              request,
            });
            return row;
          });
          break;
        } catch (e: unknown) {
          if (attempt === 0 && isSlugConflict(e)) continue;
          throw e;
        }
      }

      if (!created) {
        // Both attempts hit a slug conflict — vanishingly unlikely.
        return reply
          .code(409)
          .send({ error: 'Could not save submission. Please try again.' });
      }

      // Index the draft for admin search (the public search filters drafts out).
      void producers.searchIndex
        .upsert(created.id, 'create', request.id)
        .catch((err: unknown) => {
          request.log.warn(
            { err, contentId: created?.id },
            'enqueue search-index upsert failed',
          );
        });

      // Notify editors+ (gated on the tenant's notifyOnReaderSubmission flag).
      void notifyReaderSubmission({
        log: request.log,
        tenantId,
        contentId: created.id,
        contentTitle: created.title,
        submitterName,
        submitterEmail,
        reqId: request.id,
      });

      // Never expose the internal id or any DB detail to the public.
      return reply
        .code(201)
        .send({ success: true, message: 'Your submission has been received.' });
    },
  );
};
