import { apiFetch } from '@/lib/api';

// Mirror of FieldDefinitions in packages/types — kept local to avoid the
// workspace dep. The shape is enforced at the API layer; we trust the server.
export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'rich_text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'media_single'
  | 'media_gallery'
  | 'taxonomy_relation'
  | 'content_relation'
  | 'select'
  | 'repeater'
  | 'json_raw';

export const RESERVED_FIELD_NAMES = [
  'id',
  'slug',
  'status',
  'created_at',
  'updated_at',
  'published_at',
  'author_id',
  'content_type_id',
] as const;

export interface FieldValidations {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: string[];
}

// Sub-fields allowed inside a repeater (primitive types only).
export type SubFieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select';

export interface SubFieldDefinition {
  id: string;
  name: string;
  label: string;
  type: SubFieldType;
  required?: boolean;
  options?: string[];
}

export interface FieldDefinition {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  helpText?: string;
  order: number;
  validations?: FieldValidations;
  default?: unknown;
  // Only used when type === 'repeater'.
  subFields?: SubFieldDefinition[];
}

export interface FieldDefinitions {
  fields: FieldDefinition[];
}

/**
 * settings.taxonomies binds which taxonomies appear in the post editor's
 * Categories / Tags sidebar panels for posts of this type. Arrays are the
 * canonical shape; the server normalizes legacy single-string values to
 * 1-element arrays on save, but old reads may still surface a bare string.
 * Use `readSlugList()` to handle both.
 */
export interface ContentTypeSettings {
  taxonomies?: {
    categories?: string | string[];
    tags?: string | string[];
  };
  // Default post template for content of this type (per-post override wins).
  templates?: { default?: string };
  // Public submissions: 'information' (form data → admin table + CSV) vs 'post'
  // (real content → the editor). Only meaningful when submissionAccess !== 'none'.
  submissionKind?: 'information' | 'post';
  // Opt-in manual (drag) ordering for this type's public listing.
  manualOrder?: boolean;
  // Forward-compat: settings may carry keys we don't yet model.
  [key: string]: unknown;
}

/** Who may submit content of this type via the public submission endpoint. */
export type SubmissionAccess = 'none' | 'authenticated' | 'public';

export interface ContentType {
  id: string;
  tenantId: string | null;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  /**
   * Public-site URL template with a `{slug}` placeholder, e.g. `/article/{slug}`.
   * NULL = preview not configured; Preview button on a content row will 422 with
   * `no_public_route` until an admin sets this on the content type.
   */
  previewPath: string | null;
  isSystem: boolean;
  fieldDefinitions: FieldDefinitions;
  settings: ContentTypeSettings;
  submissionAccess: SubmissionAccess;
  createdAt: string;
  updatedAt: string;
}

/**
 * Normalize a single-or-array slug value to a string[]. Returns [] when the
 * value is absent or the wrong shape. Centralises the back-compat dance so
 * callers don't have to re-check the union every time.
 */
export function readSlugList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

export interface CreateContentTypeInput {
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  previewPath?: string | null;
  fieldDefinitions?: FieldDefinitions;
  settings?: ContentTypeSettings;
  submissionAccess?: SubmissionAccess;
}

export type UpdateContentTypeInput = Partial<CreateContentTypeInput>;

export const contentTypesApi = {
  // limit=200 matches the server cap and avoids the default 50 silently
  // truncating tenants with many types. A real install never reaches 200; if
  // it does we surface a `Load more` once the UI grows that affordance.
  list: () =>
    apiFetch<{ data: ContentType[] }>('/admin/content-types?limit=200'),
  get: (id: string) =>
    apiFetch<{ data: ContentType }>(`/admin/content-types/${id}`),
  create: (input: CreateContentTypeInput) =>
    apiFetch<{ data: ContentType }>('/admin/content-types', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateContentTypeInput) =>
    apiFetch<{ data: ContentType }>(`/admin/content-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiFetch<null>(`/admin/content-types/${id}`, { method: 'DELETE' }),
};
