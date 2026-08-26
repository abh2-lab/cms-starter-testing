// Canonical list of webhook events the API may fire. Lives here (not in
// apps/admin or apps/api) so the admin UI, the API docs generator, and any
// future consumer read from one source. Update this when adding a fired-event
// site in apps/api/src/routes/admin/{content,media}.ts.
//
// content.transitioned covers the in_review / approved / archived target
// statuses; content.published / .unpublished are emitted alongside it for
// subscribers that only care about the visible-state edges.
export const WEBHOOK_EVENTS = [
  'content.created',
  'content.updated',
  'content.published',
  'content.unpublished',
  'content.transitioned',
  'content.deleted',
  'media.uploaded',
  'media.processed',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
