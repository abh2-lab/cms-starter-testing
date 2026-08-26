import { apiFetch } from '@/lib/api';

export interface AiSettings {
  apiKey: string; // MASK if a key is stored, '' if none
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  isConfigured: boolean;
}

export type AiSettingsInput = Partial<{
  apiKey: string;
  enabled: boolean;
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
}>;

export const aiSettingsApi = {
  get: () => apiFetch<{ data: AiSettings }>('/admin/settings/ai'),
  update: (input: AiSettingsInput) =>
    apiFetch<{ data: AiSettings }>('/admin/settings/ai', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};
