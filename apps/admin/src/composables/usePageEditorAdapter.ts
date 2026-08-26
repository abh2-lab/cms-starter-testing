import { computed, ref } from 'vue';
import { pagesApi } from '@/api/pages';
import { pageTemplatesApi } from '@/api/page-templates';
import { expandTemplate } from '@/lib/expand-template';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { usePageEditorShell } from '@/composables/usePageEditorShell';
import type {
  EditorAdapter,
  EditorRevision,
  EditorTemplateOption,
} from '@/components/editor/editor-adapter';

// Dynamic-PAGE mode for the unified BlocksEditor. Reuses the existing
// usePageEditorShell (the working load / save / transition / preview-token
// contract) and exposes it as the uniform EditorAdapter, adding the page-only
// extras: the template dropdown (seed-or-switch) and the page-revision history.
// All page-specific logic stays here — the editor shell never branches on mode.

export function usePageEditorAdapter(): EditorAdapter {
  const { confirm } = useConfirm();

  const shell = usePageEditorShell({
    expectedType: 'dynamic',
    // A static page opened here bounces to the static editor (and vice-versa).
    mismatchRedirect: (id) => ({ name: 'page-edit-static', params: { id } }),
  });

  const previewUrl = ref<string | null>(null);
  const previewError = ref<string | null>(null);
  async function refreshPreview(): Promise<void> {
    const page = shell.page.value;
    if (!page) return;
    previewError.value = null;
    try {
      const { data } = await pagesApi.previewToken(page.id);
      previewUrl.value = data.previewUrl;
    } catch (e) {
      previewError.value =
        e instanceof Error ? e.message : 'Preview unavailable';
    }
  }

  const busy = computed(() => shell.saving.value || shell.transitioning.value);

  async function save(): Promise<void> {
    await shell.onSave();
    // Reload-only preview reflects the freshly-saved draft.
    await refreshPreview();
  }

  async function publish(): Promise<void> {
    await shell.onTransition('published');
  }

  // ── Template picker ──────────────────────────────────────────────────────
  const templateOptions = ref<EditorTemplateOption[]>([]);
  async function loadTemplateOptions(): Promise<void> {
    try {
      const res = await pageTemplatesApi.list();
      templateOptions.value = res.data.map((t) => ({
        key: t.key,
        name: t.name,
        blockKeys: t.blockKeys,
        source: t.source,
      }));
    } catch {
      templateOptions.value = [];
    }
  }
  void loadTemplateOptions();

  async function applyTemplate(key: string): Promise<void> {
    const opt = templateOptions.value.find((t) => t.key === key);
    if (!opt) return;
    if (shell.blocksInput.value.length > 0) {
      const ok = await confirm({
        title: 'Switch template',
        message:
          'Switching templates replaces this page’s current blocks. Text and sources in the removed blocks are lost. Continue?',
        confirmLabel: 'Switch template',
        tone: 'danger',
      });
      if (!ok) return;
    }
    const { blocks, skipped } = expandTemplate(
      opt.blockKeys,
      shell.blockMetas.value,
    );
    if (skipped.length > 0) {
      toast.error(
        `${skipped.length} block(s) in "${opt.name}" aren’t in the manifest and were skipped: ${skipped.join(', ')}`,
      );
    }
    shell.blocksInput.value = blocks;
  }

  // ── Revisions (read-only history; pages have no restore endpoint today) ──
  async function listRevisions(): Promise<EditorRevision[]> {
    const page = shell.page.value;
    if (!page) return [];
    try {
      const res = await pagesApi.revisions(page.id);
      return res.data.map((r) => ({
        revisionNumber: r.revisionNumber,
        createdAt: r.createdAt,
        changeSummary: r.changeSummary ?? null,
      }));
    } catch {
      return [];
    }
  }

  const headerName = computed(() => shell.title.value || 'Untitled page');
  const headerKey = computed(() => `/${shell.slug.value}`);
  // Once published, "Publish" is a no-op the API rejects (published→published);
  // editing + saving updates the LIVE page, so the primary button reads
  // "Update" and Publish is disabled (see shell.canPublish).
  const saveLabel = computed(() =>
    shell.page.value?.status === 'published' ? 'Update' : 'Save draft',
  );

  return {
    kind: 'page',
    loading: shell.loading,
    loadError: shell.loadError,
    blocks: shell.blocksInput,
    blockMetas: shell.blockMetas,
    dirty: shell.dirty,
    busy,
    headerName,
    headerKey,
    statusLabel: shell.statusLabel,
    canPublish: shell.canPublish,
    saveLabel,
    caps: {
      titleSlug: true,
      templatePicker: true,
      saveAsTemplate: true,
      reset: false,
      discardDraft: false,
      publish: true,
      revisions: true,
    },
    title: shell.title,
    slug: shell.slug,
    previewUrl,
    previewError,
    refreshPreview,
    save,
    publish,
    listRevisions,
    templateOptions,
    applyTemplate,
  };
}
