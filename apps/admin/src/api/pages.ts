import { apiFetch } from '@/lib/api';

export type PageType = 'static' | 'dynamic';

export type PageStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'archived';

export interface PageSeo {
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  robotsIndex?: boolean;
  robotsFollow?: boolean;
}

// Static-only layout shell id. The set is THEME-DEFINED — served from the
// server registry (@cms/blocks `pageLayoutRegistry`) and fetched via
// pagesApi.layouts(), not a fixed union here. Null on dynamic rows.
export type LayoutTemplateKey = string;

// How a static page's body is authored. 'normal' = TipTap rich text (body
// column); 'raw' = pasted html/css. Stored independently, never auto-converted.
export type PageContentMode = 'normal' | 'raw';

// One theme-coded page layout, as returned by GET /admin/pages/layouts.
export interface PageLayoutMeta {
  id: string;
  label: string;
  description: string;
  chromeless?: boolean;
}

export interface Page {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  type: PageType;
  status: PageStatus;
  html: string | null;
  css: string | null;
  layoutTemplate: LayoutTemplateKey | null;
  // Static-only. Body authoring mode + the Normal-mode TipTap JSON doc.
  contentMode: PageContentMode;
  body: unknown;
  templateKey: string | null;
  blocks: unknown[];
  seo: PageSeo;
  locale: string;
  translationGroupId: string | null;
  systemManaged: boolean;
  authorId: string | null;
  publishedBy: string | null;
  publishAt: string | null;
  unpublishAt: string | null;
  publishedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PageListItem = Page;

export interface PageRevision {
  id: string;
  pageId: string;
  tenantId: string | null;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changeSummary: string | null;
  revisionNumber: number;
  createdAt: string;
}

export interface CreatePageInput {
  type: PageType;
  title: string;
  slug: string;
  html?: string;
  css?: string;
  /** Static-only. Defaults to 'default' on the server if omitted. */
  layoutTemplate?: LayoutTemplateKey | null;
  /** Static-only. New static pages default to 'normal' on the server. */
  contentMode?: PageContentMode;
  /** Static-only, Normal mode. TipTap JSON doc (or null). */
  body?: unknown;
  templateKey?: string | null;
  blocks?: unknown[];
  seo?: PageSeo;
  locale?: string;
  publishAt?: string | null;
  unpublishAt?: string | null;
}

export type UpdatePageInput = Partial<CreatePageInput>;

export type PageSort = 'title' | 'updated_at';
export type SortDir = 'asc' | 'desc';

export interface ListPagesQuery {
  type?: PageType;
  status?: PageStatus;
  /** Free-text search over title + slug (ILIKE on both). */
  q?: string;
  sort?: PageSort;
  dir?: SortDir;
  page?: number;
  limit?: number;
}

export interface PageCounts {
  /** Tenant-wide totals (unfiltered) — drives the stat strip. */
  total: number;
  published: number;
  drafts: number;
  dynamic: number;
}

export interface ListPagesResponse {
  data: PageListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  counts: PageCounts;
}

export interface TransitionInput {
  toStatus: PageStatus;
  comment?: string;
}

export interface PreviewStaticResponse {
  html: string;
  css: string;
}

export interface PreviewTokenResponse {
  data: {
    /** Absolute URL on siteSettings.siteUrl — open with window.open as-is. */
    previewUrl: string;
    expiresAt: string;
  };
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    );
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

// ─── Block + template metadata (read-only, dev-shipped manifests) ─────────

// Narrower than content-types' FieldDefinition — blocks only need primitive
// inputs (text / number / boolean / select / url + content/category pickers,
// a kv-list for impact stats, and media references).
// Mirror of BLOCK_FIELD_TYPES in @cms/blocks — keep the two in step.
export type BlockFieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'boolean'
  | 'url'
  | 'select'
  | 'content_slug'
  | 'content_type_slug'
  | 'category_slug'
  | 'custom_field'
  | 'kv_list'
  | 'media_single'
  | 'media_gallery';

export interface BlockField {
  key: string;
  label: string;
  type: BlockFieldType;
  required?: boolean;
  helpText?: string;
  default?: unknown;
  options?: string[];
  contentTypeSlug?: string;
  taxonomySlug?: string;
  min?: number;
  max?: number;
}

export interface BlockMeta {
  key: string;
  label: string;
  category: string;
  description?: string;
  icon?: string;
  // FSE-style role (standalone | field | container | box); absent ⇒
  // standalone. The structure editor's tree canvas gates "add child" on it.
  kind?: string;
  fields: BlockField[];
  options: BlockField[];
}

export interface PageBlockInstance {
  id: string;
  block_key: string;
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  // Recursive child tree (container/box nesting — theme engine v1+). Flat
  // page lists simply omit it.
  children?: PageBlockInstance[];
}

export const blocksApi = {
  list: () => apiFetch<{ data: BlockMeta[] }>('/admin/blocks'),
};

// pageTemplatesApi moved to ./page-templates.ts when the endpoint grew CRUD
// for user-saved templates. Import from there instead.

export const pagesApi = {
  list: (query: ListPagesQuery = {}) =>
    apiFetch<ListPagesResponse>(`/admin/pages${qs(query as Record<string, string | number | undefined>)}`),

  get: (id: string) => apiFetch<Page>(`/admin/pages/${id}`),

  // Theme-coded page layouts for the static editor's Layout Template selector.
  layouts: () => apiFetch<{ data: PageLayoutMeta[] }>('/admin/pages/layouts'),

  create: (input: CreatePageInput) =>
    apiFetch<Page>('/admin/pages', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (id: string, input: UpdatePageInput) =>
    apiFetch<Page>(`/admin/pages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  remove: (id: string) =>
    apiFetch<null>(`/admin/pages/${id}`, { method: 'DELETE' }),

  transition: (id: string, input: TransitionInput) =>
    apiFetch<Page>(`/admin/pages/${id}/transitions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  duplicate: (id: string) =>
    apiFetch<Page>(`/admin/pages/${id}/duplicate`, { method: 'POST' }),

  revisions: (id: string) =>
    apiFetch<{ data: PageRevision[] }>(`/admin/pages/${id}/revisions`),

  // Debounced preview render used by the static editor. No row write.
  previewStatic: (input: { html: string; css: string; pageId?: string }) =>
    apiFetch<PreviewStaticResponse>('/admin/pages/preview-static', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  previewToken: (id: string) =>
    apiFetch<PreviewTokenResponse>(`/admin/pages/${id}/preview-token`, {
      method: 'POST',
    }),
};
