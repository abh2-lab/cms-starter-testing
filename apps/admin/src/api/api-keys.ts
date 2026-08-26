import { apiFetch } from '@/lib/api';

export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyWithSecret extends ApiKey {
  // Returned only once, on creation.
  key: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  expiresAt?: string | null;
}

export const API_KEY_SCOPES = ['read:public', 'read:admin', 'write:content'];

export const apiKeysApi = {
  list: () => apiFetch<{ data: ApiKey[] }>('/admin/api-keys'),
  create: (input: CreateApiKeyInput) =>
    apiFetch<{ data: ApiKeyWithSecret }>('/admin/api-keys', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  revoke: (id: string) =>
    apiFetch<{ data: ApiKey }>(`/admin/api-keys/${id}/revoke`, {
      method: 'POST',
    }),
};
