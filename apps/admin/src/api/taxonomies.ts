import { apiFetch } from '@/lib/api';

export type TaxonomyKind = 'category' | 'tag';

export interface Taxonomy {
  id: string;
  tenantId: string | null;
  name: string;
  slug: string;
  /**
   * Explicit Category-vs-Tag classification. Replaces the legacy
   * `isHierarchical`-only heuristic. Tags are always flat (server rejects
   * `parentId` on tag-kind terms); categories may opt into hierarchy.
   */
  kind: TaxonomyKind;
  isHierarchical: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaxonomyTerm {
  id: string;
  taxonomyId: string;
  tenantId: string | null;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaxonomyInput {
  name: string;
  slug: string;
  kind?: TaxonomyKind;
  isHierarchical?: boolean;
}
export type UpdateTaxonomyInput = Partial<CreateTaxonomyInput>;

export interface CreateTermInput {
  name: string;
  slug: string;
  description?: string | null;
  parentId?: string | null;
  sortOrder?: number;
}
export type UpdateTermInput = Partial<CreateTermInput>;

export const taxonomiesApi = {
  // limit=200 matches the server cap; see content-types.ts for the same note.
  list: () => apiFetch<{ data: Taxonomy[] }>('/admin/taxonomies?limit=200'),
  get: (id: string) => apiFetch<{ data: Taxonomy }>(`/admin/taxonomies/${id}`),
  create: (input: CreateTaxonomyInput) =>
    apiFetch<{ data: Taxonomy }>('/admin/taxonomies', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateTaxonomyInput) =>
    apiFetch<{ data: Taxonomy }>(`/admin/taxonomies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiFetch<null>(`/admin/taxonomies/${id}`, { method: 'DELETE' }),

  listTerms: (taxonomyId: string) =>
    apiFetch<{ data: TaxonomyTerm[] }>(
      `/admin/taxonomies/${taxonomyId}/terms`,
    ),
  createTerm: (taxonomyId: string, input: CreateTermInput) =>
    apiFetch<{ data: TaxonomyTerm }>(`/admin/taxonomies/${taxonomyId}/terms`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTerm: (taxonomyId: string, termId: string, input: UpdateTermInput) =>
    apiFetch<{ data: TaxonomyTerm }>(
      `/admin/taxonomies/${taxonomyId}/terms/${termId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  removeTerm: (taxonomyId: string, termId: string) =>
    apiFetch<null>(`/admin/taxonomies/${taxonomyId}/terms/${termId}`, {
      method: 'DELETE',
    }),
};

// Shared slug helper: lowercase, spaces/punctuation → hyphens, must start with
// a letter (matches the server SlugSchema regex /^[a-z][a-z0-9-]*$/).
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '');
}
