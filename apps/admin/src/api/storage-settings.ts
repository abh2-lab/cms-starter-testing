import { apiFetch } from '@/lib/api';

export type StorageProvider = 'minio' | 'aws' | 'r2' | 'do' | 'gcs';

// Secrets are always masked strings on the wire ('••••••••' when set, '' when
// not). The page only sends a secret back when the user actually retypes it.
export interface StorageSettings {
  provider: StorageProvider;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  publicMediaUrl: string;
  publicApiEndpoint: string;
  isConfigured: boolean;
}

// Every field optional — PATCH accepts any subset. Secret omitted unless retyped.
export type StorageSettingsInput = Partial<{
  provider: StorageProvider;
  bucket: string;
  region: string | null;
  forcePathStyle: boolean;
  accessKeyId: string | null;
  secretAccessKey: string;
  publicMediaUrl: string | null;
  publicApiEndpoint: string | null;
}>;

export interface TestStorageResult {
  success: boolean;
  message: string;
}

export const storageSettingsApi = {
  get: () => apiFetch<{ data: StorageSettings }>('/admin/settings/storage'),
  update: (input: StorageSettingsInput) =>
    apiFetch<{ data: StorageSettings }>('/admin/settings/storage', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  test: () =>
    apiFetch<{ data: TestStorageResult }>('/admin/settings/storage/test', {
      method: 'POST',
    }),
};
