import { computed, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { blocksApi, type BlockMeta, type PageBlockInstance } from '@/api/pages';
import { themeApi, type ThemeOverrideDetail } from '@/api/theme';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import {
  coerceBlockTree,
  type EditorAdapter,
  type EditorRevision,
} from '@/components/editor/editor-adapter';

// Template/part mode for the unified BlocksEditor. Wraps themeApi (the FSE
// override lifecycle: load → save draft → publish / discard / reset, plus
// publish-time revisions and the reload-only preview token). Mirrors the
// uniform EditorAdapter so the editor shell treats it identically to a page.

export function useThemeEditorMode(key: string): EditorAdapter {
  const { confirm } = useConfirm();

  const detail = ref<ThemeOverrideDetail | null>(null);
  const blockMetas = ref<BlockMeta[]>([]);
  const blocks = ref<PageBlockInstance[]>([]);
  const loading = ref(true);
  const loadError = ref<string | null>(null);
  const busy = ref(false);
  const dirty = ref(false);

  const previewUrl = ref<string | null>(null);
  const previewError = ref<string | null>(null);

  // Seeding the tree from the API must not trip the dirty watcher.
  let suppressDirty = false;
  function seed(d: ThemeOverrideDetail): void {
    const source = d.draftBlocks ?? d.publishedBlocks ?? d.codeBlocks;
    suppressDirty = true;
    blocks.value = coerceBlockTree(source);
    dirty.value = false;
  }
  watch(
    blocks,
    () => {
      if (suppressDirty) {
        suppressDirty = false;
        return;
      }
      dirty.value = true;
    },
    { deep: true },
  );

  async function load(): Promise<void> {
    loading.value = true;
    loadError.value = null;
    try {
      const [overrideRes, blocksRes] = await Promise.all([
        themeApi.override(key),
        blocksApi.list(),
      ]);
      detail.value = overrideRes.data;
      blockMetas.value = blocksRes.data;
      seed(overrideRes.data);
      void refreshPreview();
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Failed to load';
    } finally {
      loading.value = false;
    }
  }

  async function refreshPreview(): Promise<void> {
    previewError.value = null;
    try {
      const res = await themeApi.previewToken(key);
      previewUrl.value = res.data.previewUrl;
    } catch (e) {
      previewError.value = e instanceof Error ? e.message : 'Preview unavailable';
    }
  }

  async function save(): Promise<void> {
    busy.value = true;
    try {
      await themeApi.saveDraft(key, blocks.value);
      dirty.value = false;
      toast.success('Draft saved');
      const res = await themeApi.override(key);
      detail.value = res.data;
      await refreshPreview(); // reload-only preview reflects the new draft
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      busy.value = false;
    }
  }

  const blastRadius = computed(() => {
    const d = detail.value;
    if (!d) return 'This affects the public site.';
    if (d.kind === 'part' && (d.key === 'header' || d.key === 'footer')) {
      return `Publishing changes the site-wide ${d.name} on EVERY public page.`;
    }
    if (d.role === 'single' || d.key === 'article-sidebar') {
      return 'Publishing changes EVERY article on the public site.';
    }
    if (d.role === 'archive') {
      return 'Publishing changes EVERY category/tag listing page.';
    }
    return 'Publishing changes every public page that renders this structure.';
  });

  async function publish(): Promise<void> {
    if (dirty.value) {
      toast.error('Save the draft first — Publish makes the saved draft live.');
      return;
    }
    if (!detail.value?.hasDraft) {
      toast.error('Nothing to publish — save a draft first.');
      return;
    }
    const ok = await confirm({
      title: 'Publish structure',
      message: `${blastRadius.value}\n\nPublish the saved draft now?`,
      confirmLabel: 'Publish',
    });
    if (!ok) return;
    busy.value = true;
    try {
      await themeApi.publish(key);
      toast.success('Published');
      const res = await themeApi.override(key);
      detail.value = res.data;
      seed(res.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      busy.value = false;
    }
  }

  async function reset(): Promise<void> {
    const ok = await confirm({
      title: 'Reset to default',
      message: `Reset "${detail.value?.name ?? key}" to the code default? The published override and any draft are deleted. ${blastRadius.value}`,
      confirmLabel: 'Reset',
      tone: 'danger',
    });
    if (!ok) return;
    busy.value = true;
    try {
      await themeApi.reset(key);
      toast.success('Reset to default');
      const res = await themeApi.override(key);
      detail.value = res.data;
      seed(res.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      busy.value = false;
    }
  }

  async function discardDraft(): Promise<void> {
    const ok = await confirm({
      title: 'Discard draft',
      message: 'Discard the saved draft? Unpublished structure changes are lost.',
      confirmLabel: 'Discard',
      tone: 'danger',
    });
    if (!ok) return;
    busy.value = true;
    try {
      await themeApi.discardDraft(key);
      const res = await themeApi.override(key);
      detail.value = res.data;
      seed(res.data);
      toast.success('Draft discarded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Discard failed');
    } finally {
      busy.value = false;
    }
  }

  async function listRevisions(): Promise<EditorRevision[]> {
    try {
      const res = await themeApi.revisions(key);
      return res.data.map((r) => ({
        revisionNumber: r.revisionNumber,
        createdAt: r.createdAt,
        changeSummary: r.changeSummary,
      }));
    } catch {
      return [];
    }
  }

  async function restoreRevision(n: number): Promise<void> {
    busy.value = true;
    try {
      await themeApi.restoreRevision(key, n);
      const res = await themeApi.override(key);
      detail.value = res.data;
      seed(res.data);
      toast.success(`Revision #${n} restored into the draft`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      busy.value = false;
    }
  }

  onMounted(load);
  onBeforeRouteLeave(async () => {
    if (!dirty.value) return true;
    return confirm({
      title: 'Discard changes?',
      message: 'You have unsaved structure changes. Leave without saving?',
      confirmLabel: 'Discard',
      tone: 'danger',
    });
  });

  const headerName = computed(() => detail.value?.name ?? key);
  const headerKey = computed(() => key);
  const statusLabel = computed(() => {
    const d = detail.value;
    if (!d) return '';
    if (d.hasDraft) return 'Draft';
    if (d.customized) return 'Customized';
    return 'Default';
  });

  // Publish is meaningful only once there's a saved draft to push live.
  const canPublish = computed(() => detail.value?.hasDraft ?? false);
  const saveLabel = computed(() => 'Save draft');

  return {
    kind: detail.value?.kind === 'part' ? 'part' : 'template',
    loading,
    loadError,
    blocks,
    blockMetas,
    dirty,
    busy,
    headerName,
    headerKey,
    statusLabel,
    canPublish,
    saveLabel,
    caps: {
      titleSlug: false,
      templatePicker: false,
      saveAsTemplate: false,
      reset: true,
      discardDraft: true,
      publish: true,
      revisions: true,
    },
    previewUrl,
    previewError,
    refreshPreview,
    save,
    publish,
    reset,
    discardDraft,
    listRevisions,
    restoreRevision,
  };
}
