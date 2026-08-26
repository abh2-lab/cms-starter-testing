import { apiFetch } from '@/lib/api';

export type RateLimitUnit = 'second' | 'minute';

export interface SystemSettings {
  rateLimitMax: number;
  rateLimitWindowValue: number;
  rateLimitWindowUnit: RateLimitUnit;
  workerImageConcurrency: number;
  workerWebhookConcurrency: number;
  workerSearchIndexConcurrency: number;
  workerSchedulePublishConcurrency: number;
  workerEmailConcurrency: number;
}

export type SystemSettingsInput = Partial<SystemSettings>;

export const systemSettingsApi = {
  get: () => apiFetch<{ data: SystemSettings }>('/admin/settings/system'),
  update: (input: SystemSettingsInput) =>
    apiFetch<{ data: SystemSettings }>('/admin/settings/system', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};
