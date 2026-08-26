import { apiFetch } from '@/lib/api';

export interface Redirect {
  id: string;
  tenantId: string | null;
  fromPath: string;
  toPath: string;
  redirectType: number;
  isActive: boolean;
  hitCount: number;
  lastHitAt: string | null;
  notes: string | null;
  autoCreated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RedirectListResponse {
  data: Redirect[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export interface CreateRedirectInput {
  fromPath: string;
  toPath: string;
  redirectType?: 301 | 302;
  isActive?: boolean;
  notes?: string | null;
}
export type UpdateRedirectInput = Partial<CreateRedirectInput>;

export interface ListRedirectsParams {
  cursor?: string;
  limit?: number;
  isActive?: boolean;
}

function buildQuery(params: ListRedirectsParams): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.isActive !== undefined) sp.set('isActive', String(params.isActive));
  return sp.size > 0 ? `?${sp.toString()}` : '';
}

export const redirectsApi = {
  list: (params: ListRedirectsParams = {}) =>
    apiFetch<RedirectListResponse>(`/admin/redirects${buildQuery(params)}`),
  create: (input: CreateRedirectInput) =>
    apiFetch<{ data: Redirect }>('/admin/redirects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateRedirectInput) =>
    apiFetch<{ data: Redirect }>(`/admin/redirects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiFetch<null>(`/admin/redirects/${id}`, { method: 'DELETE' }),
};
