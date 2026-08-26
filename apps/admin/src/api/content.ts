import { apiFetch } from '@/lib/api';

export type ContentStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'archived';

export const CONTENT_STATUSES: readonly ContentStatus[] = [
  'draft',
  'in_review',
  'approved',
  'scheduled',
  'published',
  'archived',
];

export interface ContentSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string[] | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageKey: string | null;
  ogType: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImageKey: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  sitemapInclude: boolean;
  sitemapPriority: string | null;
  sitemapChangeFreq: string | null;
  schemaType: string | null;
  schemaOverrides: unknown;
}

export interface Content {
  id: string;
  tenantId: string | null;
  contentTypeId: string;
  title: string;
  slug: string;
  status: ContentStatus;
  authorId: string | null;
  publishedBy: string | null;
  publishAt: string | null;
  unpublishAt: string | null;
  publishedAt: string | null;
  featured: boolean;
  sortOrder: number;
  seo: ContentSeo | null;
  customFields: Record<string, unknown>;
  // Per-post template override; null = use the content type's default.
  templateKey: string | null;
  locale: string;
  translationGroupId: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  // Present on the single-content GET/PATCH responses (not the list).
  taxonomyTermIds?: string[];
  // Primary category slug (first term in the `categories` taxonomy), present
  // on the list response so "View on site" can substitute the `{category}`
  // permalink token. null when the row has no category.
  primaryCategorySlug?: string | null;
}

export interface ContentListResponse {
  data: Content[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    // Present on every response. `page` is 1 in legacy cursor mode; `total`
    // and `totalPages` drive the numbered pagination in the admin list.
    page: number;
    total: number;
    totalPages: number;
  };
}

export interface ListContentParams {
  cursor?: string;
  // 1-based page index. Passing this switches the API to offset-based numbered
  // pagination (returns total/totalPages) instead of the cursor contract.
  page?: number;
  limit?: number;
  status?: ContentStatus;
  contentTypeId?: string;
  authorId?: string;
  q?: string;
  submittedBy?: 'user' | 'guest';
  // Column to sort the numbered list by (offset path only). Absent → the
  // server's default newest-first order.
  sort?: ContentSort;
  dir?: SortDir;
  // Category filter — only content attached to this taxonomy term id.
  taxonomyTermId?: string;
}

// Sortable columns exposed by the ContentList table headers. Keys match the
// DataTable column `key`s so a header click maps straight to the API param.
export type ContentSort = 'title' | 'updated_at' | 'created_at';
export type SortDir = 'asc' | 'desc';

// Tenant-wide status tallies for the ContentList stat strip (GET /counts).
export interface ContentCounts {
  total: number;
  published: number;
  drafts: number;
  inReview: number;
  scheduled: number;
}

export interface CreateContentInput {
  contentTypeId: string;
  title: string;
  slug: string;
  customFields?: Record<string, unknown>;
  templateKey?: string | null;
  locale?: string;
  publishAt?: string | null;
  unpublishAt?: string | null;
  featured?: boolean;
  sortOrder?: number;
}

export type UpdateContentInput = Partial<
  Omit<CreateContentInput, 'contentTypeId'>
> & {
  seo?: ContentSeo;
  taxonomyTermIds?: string[];
};

export interface TransitionInput {
  toStatus: ContentStatus;
  comment?: string | null;
}

export interface ContentRevision {
  id: string;
  contentId: string;
  tenantId: string | null;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changeSummary: string | null;
  revisionNumber: number;
  createdAt: string;
}

function buildQuery(params: ListContentParams): string {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.status) sp.set('status', params.status);
  if (params.contentTypeId) sp.set('contentTypeId', params.contentTypeId);
  if (params.authorId) sp.set('authorId', params.authorId);
  if (params.q) sp.set('q', params.q);
  if (params.submittedBy) sp.set('submittedBy', params.submittedBy);
  if (params.sort) sp.set('sort', params.sort);
  if (params.dir) sp.set('dir', params.dir);
  if (params.taxonomyTermId) sp.set('taxonomyTermId', params.taxonomyTermId);
  return sp.size > 0 ? `?${sp.toString()}` : '';
}

export const contentApi = {
  list: (params: ListContentParams = {}) =>
    apiFetch<ContentListResponse>(`/admin/content${buildQuery(params)}`),
  counts: () => apiFetch<{ data: ContentCounts }>('/admin/content/counts'),
  get: (id: string) => apiFetch<{ data: Content }>(`/admin/content/${id}`),
  duplicate: (id: string) =>
    apiFetch<{ data: Content }>(`/admin/content/${id}/duplicate`, {
      method: 'POST',
    }),
  create: (input: CreateContentInput) =>
    apiFetch<{ data: Content }>('/admin/content', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateContentInput) =>
    apiFetch<{ data: Content }>(`/admin/content/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  // Batch-set sort_order on rows of ONE content type (drag-to-reorder / Sort
  // A→Z). The public archive reads this order via ?sort=order.
  reorder: (contentTypeId: string, items: { id: string; sortOrder: number }[]) =>
    apiFetch<{ data: { ok: boolean } }>('/admin/content/reorder', {
      method: 'PUT',
      body: JSON.stringify({ contentTypeId, items }),
    }),
  // Clear a type's hand-set order back to newest-first (sort_order → 0).
  resetOrder: (contentTypeId: string) =>
    apiFetch<{ data: { ok: boolean } }>('/admin/content/reorder/reset', {
      method: 'POST',
      body: JSON.stringify({ contentTypeId }),
    }),
  remove: (id: string) =>
    apiFetch<null>(`/admin/content/${id}`, { method: 'DELETE' }),
  transition: (id: string, input: TransitionInput) =>
    apiFetch<{ data: Content }>(`/admin/content/${id}/transitions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listRevisions: (id: string) =>
    apiFetch<{ data: ContentRevision[] }>(
      `/admin/content/${id}/revisions`,
    ),
  previewToken: (id: string) =>
    apiFetch<{ data: { previewUrl: string; expiresAt: string } }>(
      `/admin/content/${id}/preview-token`,
      { method: 'POST' },
    ),
};
