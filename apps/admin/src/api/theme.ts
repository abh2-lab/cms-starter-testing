import { apiFetch } from '@/lib/api';
import type { BlockField, PageBlockInstance } from '@/api/pages';

// Theme & system routes — the read-only manifest of the public site's
// code-defined URLs (Nuxt page files with no `pages` row). Mirrors
// apps/api/src/lib/theme-routes.ts. Surfaced on the Pages screen so every URL
// the site serves is discoverable from the admin.

export type ThemeRouteKind = 'singleton' | 'template';
export type ThemeRouteDriver = 'Content' | 'Taxonomies' | 'App';

export interface ThemeRoute {
  path: string;
  label: string;
  description: string;
  kind: ThemeRouteKind;
  drivenBy: ThemeRouteDriver;
  viewPath: string | null;
  manage: { label: string; routeName: string } | null;
}

// ─── Structure editor (theme engine v2.0) ──────────────────────────────────
// Templates/parts list, the draft → publish → reset override lifecycle,
// publish-time revisions, and the iframe preview token. Mirrors the shapes
// served by apps/api/src/routes/admin/theme.ts.

export interface ThemeOverrideFlags {
  customized: boolean;
  hasDraft: boolean;
  updateAvailable: boolean;
}

export interface ThemeStructureEntry extends ThemeOverrideFlags {
  key: string;
  kind: 'template' | 'part';
  role: string | null;
  name: string;
  description: string | null;
  version: number;
  baseVersion: number | null;
  updatedAt: string | null;
  publishedAt: string | null;
  lastEditedBy: { name: string | null; at: string | null } | null;
}

export interface ThemeMeta {
  name: string;
  version: string;
  description: string;
}

export interface ThemeOverrideDetail extends ThemeOverrideFlags {
  key: string;
  kind: 'template' | 'part';
  role: string | null;
  name: string;
  description: string | null;
  version: number;
  codeBlocks: PageBlockInstance[];
  draftBlocks: PageBlockInstance[] | null;
  publishedBlocks: PageBlockInstance[] | null;
  baseVersion: number | null;
  updatedAt: string | null;
  publishedAt: string | null;
}

export interface ThemeOverrideRevision {
  id: string;
  revisionNumber: number;
  changeSummary: string | null;
  changedBy: string | null;
  createdAt: string;
}

// ─── Per-block default overrides (theme engine v2 Phase 5) ──────────────────
// Edit one block's default fields (copy) + options (sources) from the Block
// Gallery; saved as a DB override applied site-wide. Mirrors the block-defaults
// endpoints in apps/api/src/routes/admin/theme.ts.

export interface BlockDefaultsValues {
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
}

export interface BlockDefaultsDetail {
  key: string;
  label: string;
  description: string | null;
  category: string;
  fieldsSchema: BlockField[];
  optionsSchema: BlockField[];
  codeFields: Record<string, unknown>;
  codeOptions: Record<string, unknown>;
  draft: BlockDefaultsValues | null;
  published: BlockDefaultsValues | null;
  customized: boolean;
  hasDraft: boolean;
}

export interface BlockDefaultsFlags {
  key: string;
  customized: boolean;
  hasDraft: boolean;
}

export const themeApi = {
  routes: () => apiFetch<{ data: ThemeRoute[] }>('/admin/theme/routes'),

  meta: () => apiFetch<{ data: ThemeMeta }>('/admin/theme/meta'),

  structure: () =>
    apiFetch<{ data: ThemeStructureEntry[] }>('/admin/theme/structure'),

  override: (key: string) =>
    apiFetch<{ data: ThemeOverrideDetail }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}`,
    ),

  saveDraft: (key: string, blocks: PageBlockInstance[]) =>
    apiFetch<{ data: ThemeOverrideFlags & { key: string } }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ blocks }) },
    ),

  publish: (key: string) =>
    apiFetch<{ data: ThemeOverrideFlags & { key: string } }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}/publish`,
      { method: 'POST' },
    ),

  discardDraft: (key: string) =>
    apiFetch<{ data: ThemeOverrideFlags & { key: string } }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}/discard-draft`,
      { method: 'POST' },
    ),

  reset: (key: string) =>
    apiFetch<{ data: ThemeOverrideFlags & { key: string } }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}/reset`,
      { method: 'POST' },
    ),

  revisions: (key: string) =>
    apiFetch<{ data: ThemeOverrideRevision[] }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}/revisions`,
    ),

  restoreRevision: (key: string, revisionNumber: number) =>
    apiFetch<{ data: ThemeOverrideFlags & { key: string } }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}/revisions/${revisionNumber}/restore`,
      { method: 'POST' },
    ),

  previewToken: (key: string) =>
    apiFetch<{ data: { previewUrl: string; expiresAt: string } }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}/preview-token`,
      { method: 'POST' },
    ),

  // Live public path a template/part renders, for the Theme Settings
  // "View on site" button. `path` is null when no content stands it up yet.
  viewUrl: (key: string) =>
    apiFetch<{ data: { path: string | null } }>(
      `/admin/theme/overrides/${encodeURIComponent(key)}/view-url`,
    ),

  // ─── Block defaults ───────────────────────────────────────────────────────

  blockDefaults: (key: string) =>
    apiFetch<{ data: BlockDefaultsDetail }>(
      `/admin/theme/block-defaults/${encodeURIComponent(key)}`,
    ),

  saveBlockDefaults: (
    key: string,
    fields: Record<string, unknown>,
    options: Record<string, unknown>,
  ) =>
    apiFetch<{ data: BlockDefaultsFlags }>(
      `/admin/theme/block-defaults/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ fields, options }) },
    ),

  publishBlockDefaults: (key: string) =>
    apiFetch<{ data: BlockDefaultsFlags }>(
      `/admin/theme/block-defaults/${encodeURIComponent(key)}/publish`,
      { method: 'POST' },
    ),

  discardBlockDraft: (key: string) =>
    apiFetch<{ data: BlockDefaultsFlags }>(
      `/admin/theme/block-defaults/${encodeURIComponent(key)}/discard-draft`,
      { method: 'POST' },
    ),

  resetBlockDefaults: (key: string) =>
    apiFetch<{ data: BlockDefaultsFlags }>(
      `/admin/theme/block-defaults/${encodeURIComponent(key)}/reset`,
      { method: 'POST' },
    ),

  blockPreviewToken: (key: string) =>
    apiFetch<{ data: { previewUrl: string; expiresAt: string } }>(
      `/admin/theme/block-defaults/${encodeURIComponent(key)}/preview-token`,
      { method: 'POST' },
    ),
};
