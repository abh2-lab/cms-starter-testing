import { apiFetch } from '@/lib/api';

export interface MonitoringSettings {
  sentryDsn: string;
  environment: string;
  releaseTag: string;
  tracesSampleRate: number;
  captureUnhandledErrors: boolean;
  includeUserContext: boolean;
  isConfigured: boolean;
  isPartial: boolean;
}

export type MonitoringSettingsInput = Partial<{
  sentryDsn: string;
  environment: string | null;
  releaseTag: string | null;
  tracesSampleRate: number;
  captureUnhandledErrors: boolean;
  includeUserContext: boolean;
}>;

export const monitoringSettingsApi = {
  get: () =>
    apiFetch<{ data: MonitoringSettings }>('/admin/settings/monitoring'),
  update: (input: MonitoringSettingsInput) =>
    apiFetch<{ data: MonitoringSettings }>('/admin/settings/monitoring', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};
