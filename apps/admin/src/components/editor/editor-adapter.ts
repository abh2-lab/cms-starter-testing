import type { ComputedRef, Ref } from 'vue';
import type { BlockMeta, PageBlockInstance } from '@/api/pages';

// The uniform contract the unified BlocksEditor renders against. Both modes —
// pages (usePageEditorAdapter) and templates/parts (useThemeEditorMode) —
// return this exact shape, so the editor shell never branches on mode for
// load / save / preview / publish; it just calls the adapter. All the
// mode-specific logic (and the working page save/transition contract) lives
// inside the composables, not the shell.

export interface EditorRevision {
  revisionNumber: number;
  createdAt: string;
  changeSummary?: string | null;
}

export interface EditorTemplateOption {
  key: string;
  name: string;
  blockKeys: string[];
  source: 'code' | 'user';
}

/** Which controls the top bar shows for this mode. */
export interface EditorCaps {
  titleSlug: boolean; // pages: editable title + slug
  templatePicker: boolean; // pages: choose/switch a page template
  saveAsTemplate: boolean; // pages: save the current blocks as a template
  reset: boolean; // templates/parts: reset to code default
  discardDraft: boolean; // templates/parts: drop the pending draft
  publish: boolean; // both
  revisions: boolean; // both
}

export interface EditorAdapter {
  kind: 'page' | 'template' | 'part';
  loading: Ref<boolean>;
  loadError: Ref<string | null>;

  // The edited tree + the block manifest (shared by library + popup + outline).
  blocks: Ref<PageBlockInstance[]>;
  blockMetas: Ref<BlockMeta[]>;

  dirty: Ref<boolean>;
  busy: Ref<boolean>;
  headerName: ComputedRef<string>; // page title or template/part name
  headerKey: ComputedRef<string>; // page slug or template/part key
  statusLabel: ComputedRef<string>;
  // Whether Publish is a valid action right now (page: the status can move to
  // published — false once it already IS published; template/part: there's a
  // draft to publish). The top bar disables Publish when false so an
  // already-published page can't fire an invalid published→published transition.
  canPublish: ComputedRef<boolean>;
  // Primary-save button label (page: "Update" once published — saving a
  // published page updates the LIVE page — else "Save draft"; template/part:
  // "Save draft").
  saveLabel: ComputedRef<string>;
  caps: EditorCaps;

  // Page-only editable refs (present iff caps.titleSlug).
  title?: Ref<string>;
  slug?: Ref<string>;

  // Live preview iframe source — refreshPreview() re-issues a token + sets it.
  previewUrl: Ref<string | null>;
  previewError: Ref<string | null>;
  refreshPreview: () => Promise<void>;

  // Core actions (publish present iff caps.publish, etc.).
  save: () => Promise<void>;
  publish: () => Promise<void>;
  reset?: () => Promise<void>;
  discardDraft?: () => Promise<void>;
  listRevisions?: () => Promise<EditorRevision[]>;
  restoreRevision?: (n: number) => Promise<void>;

  // Page template picker (present iff caps.templatePicker).
  templateOptions?: Ref<EditorTemplateOption[]>;
  applyTemplate?: (key: string) => Promise<void>;
  openSaveAsTemplate?: () => void;
}

/** Defensive jsonb → PageBlockInstance[] (mirrors the API composer rules:
 *  drop keyless entries, default fields/options, keep recursive children). */
export function coerceBlockTree(raw: unknown): PageBlockInstance[] {
  if (!Array.isArray(raw)) return [];
  const out: PageBlockInstance[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const key = obj['block_key'];
    if (typeof key !== 'string' || key.length === 0) continue;
    const id =
      typeof obj['id'] === 'string' && obj['id'].length > 0
        ? obj['id']
        : `${key}-${Math.random().toString(36).slice(2, 8)}`;
    const fields =
      obj['fields'] && typeof obj['fields'] === 'object'
        ? (obj['fields'] as Record<string, unknown>)
        : {};
    const options =
      obj['options'] && typeof obj['options'] === 'object'
        ? (obj['options'] as Record<string, unknown>)
        : {};
    const node: PageBlockInstance = { id, block_key: key, fields, options };
    if (Array.isArray(obj['children']) && obj['children'].length > 0) {
      node.children = coerceBlockTree(obj['children']);
    }
    out.push(node);
  }
  return out;
}
