import { z } from 'zod';

// reqId is the API's Fastify request id (UUIDv4) of the request that
// originally dispatched the job — when present it lets the worker's child
// logger stamp the same value pino uses on the API side, so a single grep
// links the admin action to every downstream job line. Optional because
// repeatable sweeps and back-fill scripts have no originating request.
const JobMeta = { reqId: z.string().optional() };

// ─── search-index ──────────────────────────────────────────────────────────

export const SearchIndexUpsertJob = z.object({
  contentId: z.string().uuid(),
  reason: z.enum(['create', 'update', 'transition', 'delete']),
  ...JobMeta,
});
export type SearchIndexUpsertJob = z.infer<typeof SearchIndexUpsertJob>;

export const SearchIndexRemoveJob = z.object({
  contentId: z.string().uuid(),
  ...JobMeta,
});
export type SearchIndexRemoveJob = z.infer<typeof SearchIndexRemoveJob>;

// ─── webhook-deliver ───────────────────────────────────────────────────────

export const WebhookDeliverJob = z.object({
  webhookId: z.string().uuid(),
  eventName: z.string().min(1),
  payload: z.record(z.unknown()),
  ...JobMeta,
});
export type WebhookDeliverJob = z.infer<typeof WebhookDeliverJob>;

// ─── schedule-publish ──────────────────────────────────────────────────────

export const SchedulePublishJob = z.object({
  contentId: z.string().uuid(),
  // The publishAt the API enqueued for — the worker re-reads the row and
  // skips if the DB no longer agrees (someone rescheduled in flight).
  expectedAtIso: z.string().datetime(),
  ...JobMeta,
});
export type SchedulePublishJob = z.infer<typeof SchedulePublishJob>;

export const ScheduleUnpublishJob = z.object({
  contentId: z.string().uuid(),
  expectedAtIso: z.string().datetime(),
  ...JobMeta,
});
export type ScheduleUnpublishJob = z.infer<typeof ScheduleUnpublishJob>;

// ─── image-process ─────────────────────────────────────────────────────────

export const ImageProcessJob = z.object({
  mediaId: z.string().uuid(),
  tenantId: z.string().uuid(),
  storageKey: z.string().min(1),
  ...JobMeta,
});
export type ImageProcessJob = z.infer<typeof ImageProcessJob>;

// ─── email-send ────────────────────────────────────────────────────────────

export const EmailSendJob = z.object({
  kind: z.enum([
    'review_requested',
    'review_approved',
    'review_rejected',
    'reader_submission',
  ]),
  to: z.string().email(),
  // Tenant whose email_settings the worker resolves the transport from. Null
  // in single-tenant mode (the NULL-tenant settings row). Optional so legacy
  // enqueues without it fall back to the env-configured transport.
  tenantId: z.string().uuid().nullable().optional(),
  context: z.object({
    contentId: z.string().uuid(),
    contentTitle: z.string(),
    actorDisplayName: z.string(),
    comment: z.string().nullable(),
  }),
  ...JobMeta,
});
export type EmailSendJob = z.infer<typeof EmailSendJob>;

// ─── maintenance ───────────────────────────────────────────────────────────

// Repeatable sweep jobs carry no per-run payload, but may still carry reqId
// if the cron is triggered from an admin-initiated sweep (rare).
export const MaintenanceSweepJob = z.object({ ...JobMeta });
export type MaintenanceSweepJob = z.infer<typeof MaintenanceSweepJob>;
