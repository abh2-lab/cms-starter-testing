import { apiFetch } from '@/lib/api';

// Post (single) templates — the read-only list of dev-shipped article layouts
// a content row can render through. Mirrors @cms/blocks post-templates. Used by
// the content editor (per-post override) and the content-type form (per-type
// default).

export interface PostTemplate {
  key: string;
  label: string;
  description?: string;
}

export const postTemplatesApi = {
  list: () => apiFetch<{ data: PostTemplate[] }>('/admin/post-templates'),
};
