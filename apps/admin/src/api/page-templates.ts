import { apiFetch } from '@/lib/api';

// Page Templates — the merged code-shipped + DB-stored list the API returns.
// Tagged with `source` so the UI can distinguish "starter pack" templates
// (immutable, ship with packages/blocks) from "your team's saved layouts"
// (tenant-scoped, editable). `id` is null for code rows; DB id for user rows.
//
// Server-side filter: 0-block templates are never returned, so the picker
// never has to defend against rendering a meaningless entry.

export interface PageTemplate {
  source: 'code' | 'user';
  /** Null for code-shipped rows; UUID for DB rows. */
  id: string | null;
  /** Stable slug; used as React-style key and for collision detection. */
  key: string;
  name: string;
  description: string | null;
  /** Ordered list of block_key strings — the template's arrangement. */
  blockKeys: string[];
  authorId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  blockKeys: string[];
}

export const pageTemplatesApi = {
  list: () =>
    apiFetch<{ data: PageTemplate[] }>('/admin/page-templates'),

  create: (input: CreateTemplateInput) =>
    apiFetch<{ data: PageTemplate }>('/admin/page-templates', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  remove: (id: string) =>
    apiFetch<null>(`/admin/page-templates/${id}`, { method: 'DELETE' }),
};
