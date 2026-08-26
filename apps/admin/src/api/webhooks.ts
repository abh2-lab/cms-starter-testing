import { apiFetch } from '@/lib/api';

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookWithSecret extends Webhook {
  // Returned only once, on creation.
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventName: string;
  payload: unknown;
  attemptNumber: number;
  responseStatus: number | null;
  responseBody: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

export interface CreateWebhookInput {
  name: string;
  url: string;
  events?: string[];
  isActive?: boolean;
}
export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  events?: string[];
  isActive?: boolean;
}

export interface TestResult {
  ok: boolean;
  status: number | null;
  body: string | null;
}

// Canonical event list lives in @cms/types/webhook-events so the docs
// generator and any other consumer share one source. Re-export here so
// existing imports (Webhooks.vue) keep working unchanged.
export { WEBHOOK_EVENTS, type WebhookEvent } from '@cms/types';

export const webhooksApi = {
  list: () => apiFetch<{ data: Webhook[] }>('/admin/webhooks'),
  create: (input: CreateWebhookInput) =>
    apiFetch<{ data: WebhookWithSecret }>('/admin/webhooks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateWebhookInput) =>
    apiFetch<{ data: Webhook }>(`/admin/webhooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiFetch<null>(`/admin/webhooks/${id}`, { method: 'DELETE' }),
  deliveries: (id: string) =>
    apiFetch<{ data: WebhookDelivery[] }>(`/admin/webhooks/${id}/deliveries`),
  test: (id: string) =>
    apiFetch<{ data: TestResult }>(`/admin/webhooks/${id}/test`, {
      method: 'POST',
    }),
  // Mint a fresh signing secret. Returns the new secret ONCE (same
  // contract as create); subscribers must update their receivers to
  // match. Required for legacy rows whose secret_encrypted column is NULL
  // (created before the Phase 6 migration) — without rotating, the worker
  // can't HMAC-sign their deliveries.
  rotateSecret: (id: string) =>
    apiFetch<{ data: WebhookWithSecret }>(
      `/admin/webhooks/${id}/rotate-secret`,
      { method: 'POST' },
    ),
};
