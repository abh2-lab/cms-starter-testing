import { apiFetch } from '@/lib/api';
import type { AdminUser } from '@/stores/auth';

export interface SetupStatusResponse {
  needsSetup: boolean;
}

export interface BootstrapRequest {
  email: string;
  displayName: string;
  siteName: string;
  password: string;
  loadSampleData: boolean;
}

export interface BootstrapResponse {
  user: AdminUser;
  tenant: { id: string; slug: string; name: string };
  expiresAt: string;
}

export const setupApi = {
  status: () => apiFetch<SetupStatusResponse>('/admin/setup/status'),
  bootstrap: (input: BootstrapRequest) =>
    apiFetch<BootstrapResponse>('/admin/setup/bootstrap', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
