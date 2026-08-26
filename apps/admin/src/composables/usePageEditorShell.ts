import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  onBeforeRouteLeave,
  useRoute,
  useRouter,
  type RouteLocationRaw,
} from 'vue-router';
import { ApiError } from '@/lib/api';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import {
  pagesApi,
  blocksApi,
  type Page,
  type PageStatus,
  type PageSeo,
  type BlockMeta,
  type PageBlockInstance,
  type LayoutTemplateKey,
  type PageLayoutMeta,
  type PageContentMode,
} from '@/api/pages';

// Shell logic shared by the static page editor (PageEditStatic.vue, inside
// AppLayout) and the unified blocks editor's page mode (usePageEditorAdapter →
// BlocksEditor.vue, full-screen).
//
// Each call site supplies:
//   - expectedType: 'static' | 'dynamic' — the route's expected page type
//   - mismatchRedirect: a RouteLocationRaw-builder receiving the page id —
//     where to send the user when the loaded page's type doesn't match the
//     route. Static editor redirects to the dynamic builder URL when it
//     gets a dynamic page, and vice versa.
//
// Everything else (load, save, transitions, dirty tracking, navigate-away
// guard, preview-token, duplicate, delete) is identical so it lives here.

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface PageEditorShellOptions {
  expectedType: 'static' | 'dynamic';
  mismatchRedirect: (id: string) => RouteLocationRaw;
}

export function usePageEditorShell(opts: PageEditorShellOptions) {
  const route = useRoute();
  const router = useRouter();
  const { confirm } = useConfirm();

  const id = computed(() => route.params['id'] as string);

  const page = ref<Page | null>(null);
  const loading = ref(true);
  const loadError = ref<string | null>(null);
  const saving = ref(false);
  const transitioning = ref(false);
  const lastSaveOk = ref(true);

  // Editable copies, mirrored back on save.
  const title = ref('');
  const slug = ref('');
  const locale = ref('en');

  // Static-branch state.
  const htmlInput = ref('');
  const cssInput = ref('');
  const layoutTemplate = ref<LayoutTemplateKey>('default');
  // Content mode + the Normal-mode TipTap body (separate storage; never
  // auto-converted between modes).
  const contentMode = ref<PageContentMode>('normal');
  const bodyInput = ref<object | null>(null);
  // Theme-coded layouts for the Layout Template selector (static pages).
  const layoutOptions = ref<PageLayoutMeta[]>([]);

  // Dynamic-branch state.
  const blocksInput = ref<PageBlockInstance[]>([]);
  const blockMetas = ref<BlockMeta[]>([]);
  const loadingBlockMetas = ref(false);
  const blockMetasError = ref<string | null>(null);

  // SEO as a single reactive object so the consumer can pass it through one
  // v-model rather than half a dozen update handlers.
  const seoState = ref<PageSeo>({
    metaTitle: null,
    metaDescription: null,
    ogImageUrl: null,
    canonicalUrl: null,
    robotsIndex: true,
    robotsFollow: true,
  });

  const dirty = ref(false);
  // Set true while we mirror the API's response back into the form refs after
  // a save/transition; without this the dirty watchers (which flush on next
  // tick) would re-mark the form dirty immediately after we cleared the flag,
  // making the next Publish click prompt "Save first?" every time.
  let suppressDirty = false;
  function markDirty(): void {
    if (suppressDirty) return;
    dirty.value = true;
    lastSaveOk.value = true;
  }

  // Defensive normalisation for the blocks jsonb. Matches the API-side
  // composer rules: drop entries with no block_key, default fields/options
  // to empty objects, generate an id if missing. RECURSES `children` — dynamic
  // pages are tree-capable in the unified editor (container/box nesting), and
  // the public composer already recurses pages.blocks, so children must
  // survive load + save round-trips.
  function coerceBlocks(raw: unknown): PageBlockInstance[] {
    if (!Array.isArray(raw)) return [];
    const out: PageBlockInstance[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const key = obj['block_key'];
      if (typeof key !== 'string' || key.length === 0) continue;
      const blockId =
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
      const node: PageBlockInstance = { id: blockId, block_key: key, fields, options };
      if (Array.isArray(obj['children']) && obj['children'].length > 0) {
        node.children = coerceBlocks(obj['children']);
      }
      out.push(node);
    }
    return out;
  }

  async function loadBlockMetas(): Promise<void> {
    loadingBlockMetas.value = true;
    blockMetasError.value = null;
    try {
      const res = await blocksApi.list();
      blockMetas.value = res.data;
    } catch (e) {
      blockMetasError.value =
        e instanceof Error ? e.message : 'Failed to load blocks';
    } finally {
      loadingBlockMetas.value = false;
    }
  }

  // Theme-coded page layouts for the static editor's selector. Non-fatal on
  // failure — the editor still works; the selector just falls back to the
  // stored value.
  async function loadLayouts(): Promise<void> {
    try {
      const res = await pagesApi.layouts();
      layoutOptions.value = res.data;
    } catch {
      layoutOptions.value = [];
    }
  }

  async function load(): Promise<void> {
    loading.value = true;
    loadError.value = null;
    try {
      const p = await pagesApi.get(id.value);
      if (p.type !== opts.expectedType) {
        await router.replace(opts.mismatchRedirect(p.id));
        return;
      }
      page.value = p;
      title.value = p.title;
      slug.value = p.slug;
      locale.value = p.locale;
      htmlInput.value = p.html ?? '';
      cssInput.value = p.css ?? '';
      layoutTemplate.value = p.layoutTemplate ?? 'default';
      // Existing rows have no contentMode → 'raw' (their content is in html/css).
      contentMode.value = p.contentMode ?? 'raw';
      bodyInput.value =
        p.body && typeof p.body === 'object' ? p.body : null;
      blocksInput.value = coerceBlocks(p.blocks);
      seoState.value = {
        metaTitle: p.seo?.metaTitle ?? null,
        metaDescription: p.seo?.metaDescription ?? null,
        ogImageUrl: p.seo?.ogImageUrl ?? null,
        canonicalUrl: p.seo?.canonicalUrl ?? null,
        robotsIndex: p.seo?.robotsIndex ?? true,
        robotsFollow: p.seo?.robotsFollow ?? true,
      };
      dirty.value = false;
      if (p.type === 'dynamic' && blockMetas.value.length === 0) {
        void loadBlockMetas();
      }
      if (p.type === 'static' && layoutOptions.value.length === 0) {
        void loadLayouts();
      }
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Failed to load';
    } finally {
      loading.value = false;
    }
  }

  async function onSave(): Promise<void> {
    if (!page.value) return;
    saving.value = true;
    try {
      const updated = await pagesApi.update(page.value.id, {
        title: title.value,
        slug: slug.value,
        locale: locale.value,
        html: htmlInput.value,
        css: cssInput.value,
        ...(page.value.type === 'static'
          ? {
              layoutTemplate: layoutTemplate.value,
              contentMode: contentMode.value,
              body: bodyInput.value,
            }
          : {}),
        blocks: blocksInput.value,
        seo: seoState.value,
      });
      // Mirror the API's response back without re-marking dirty. try/finally
      // so an exception in the middle still releases the suppression flag.
      suppressDirty = true;
      try {
        page.value = updated;
        htmlInput.value = updated.html ?? '';
        cssInput.value = updated.css ?? '';
        contentMode.value = updated.contentMode ?? 'raw';
        bodyInput.value =
          updated.body && typeof updated.body === 'object'
            ? updated.body
            : null;
        blocksInput.value = coerceBlocks(updated.blocks);
        await nextTick();
        dirty.value = false;
      } finally {
        suppressDirty = false;
      }
      lastSaveOk.value = true;
      toast.success(
        page.value?.status === 'published'
          ? 'Saved — changes are live'
          : 'Saved',
      );
    } catch (e) {
      lastSaveOk.value = false;
      if (e instanceof ApiError && e.status === 409) {
        toast.error('A page with this slug already exists.');
      } else {
        toast.error(e instanceof Error ? e.message : 'Save failed');
      }
    } finally {
      saving.value = false;
    }
  }

  async function onTransition(toStatus: PageStatus): Promise<void> {
    if (!page.value) return;
    if (dirty.value) {
      const ok = await confirm({
        title: 'Save first?',
        message: 'You have unsaved changes. Save before transitioning?',
        confirmLabel: 'Save and continue',
      });
      if (!ok) return;
      await onSave();
      if (dirty.value) return;
    }
    transitioning.value = true;
    try {
      const updated = await pagesApi.transition(page.value.id, { toStatus });
      // Same suppression pattern as onSave — the server echoes the page back
      // and we don't want the mirror to re-flip dirty.
      suppressDirty = true;
      try {
        page.value = updated;
        htmlInput.value = updated.html ?? '';
        cssInput.value = updated.css ?? '';
        contentMode.value = updated.contentMode ?? 'raw';
        bodyInput.value =
          updated.body && typeof updated.body === 'object'
            ? updated.body
            : null;
        blocksInput.value = coerceBlocks(updated.blocks);
        await nextTick();
        dirty.value = false;
      } finally {
        suppressDirty = false;
      }
      toast.success(`Status: ${toStatus}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error('Transition not allowed from the current status.');
      } else {
        toast.error(e instanceof Error ? e.message : 'Transition failed');
      }
    } finally {
      transitioning.value = false;
    }
  }

  async function onDuplicate(): Promise<void> {
    if (!page.value) return;
    try {
      const copy = await pagesApi.duplicate(page.value.id);
      toast.success(`Duplicated as "${copy.title}"`);
      // Route by type — duplicates inherit the source's type.
      const target =
        copy.type === 'static'
          ? { name: 'page-edit-static', params: { id: copy.id } }
          : { name: 'page-edit-dynamic', params: { id: copy.id } };
      await router.push(target);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Duplicate failed');
    }
  }

  async function onDelete(): Promise<void> {
    if (!page.value || page.value.systemManaged) return;
    const ok = await confirm({
      title: 'Delete page',
      message: `Delete "${page.value.title}"? Soft delete — the row remains for audit but is hidden from the public site immediately.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await pagesApi.remove(page.value.id);
      toast.success('Deleted');
      await router.push({ name: 'pages' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function onPreviewInNewTab(): Promise<void> {
    if (!page.value) return;
    try {
      const { data } = await pagesApi.previewToken(page.value.id);
      window.open(data.previewUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview token failed');
    }
  }

  // Dirty-tracking watches. Each editor mounts these by virtue of calling
  // this composable; the consumer doesn't repeat them.
  watch(
    [title, slug, locale, htmlInput, cssInput, layoutTemplate, contentMode],
    markDirty,
  );
  watch(seoState, markDirty, { deep: true });
  watch(blocksInput, markDirty, { deep: true });
  watch(bodyInput, markDirty, { deep: true });

  function beforeUnload(e: BeforeUnloadEvent): void {
    if (dirty.value) {
      e.preventDefault();
      e.returnValue = '';
    }
  }
  onMounted(() => {
    window.addEventListener('beforeunload', beforeUnload);
    void load();
  });
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', beforeUnload);
  });
  onBeforeRouteLeave(async (to) => {
    // The mismatch-redirect we trigger from load() is a legitimate
    // navigation — don't prompt for those.
    if (!dirty.value) return true;
    if (
      to.name === 'page-edit-static' ||
      to.name === 'page-edit-dynamic'
    ) {
      // mismatch handler. Allow.
      return true;
    }
    const ok = await confirm({
      title: 'Discard changes?',
      message: 'You have unsaved changes. Leave without saving?',
      confirmLabel: 'Discard',
      tone: 'danger',
    });
    return ok;
  });

  const statusLabel = computed(() =>
    page.value?.status.replace('_', ' ') ?? '',
  );

  const saveState = computed<SaveState>(() => {
    if (saving.value) return 'saving';
    if (!lastSaveOk.value) return 'error';
    if (dirty.value) return 'dirty';
    return 'saved';
  });

  // Mirror the API's ALLOWED_TRANSITIONS so the client only shows
  // buttons the server will accept.
  const availableTransitions = computed<PageStatus[]>(() => {
    const s = page.value?.status;
    if (!s) return [];
    switch (s) {
      case 'draft':     return ['in_review', 'scheduled', 'published'];
      case 'in_review': return ['draft', 'approved'];
      case 'approved':  return ['draft', 'scheduled', 'published'];
      case 'scheduled': return ['draft', 'published'];
      case 'published': return ['archived'];
      case 'archived':  return ['draft'];
      default:          return [];
    }
  });

  const canPublish = computed(() =>
    availableTransitions.value.includes('published'),
  );

  function transitionLabel(s: PageStatus): string {
    switch (s) {
      case 'draft':     return 'Move to draft';
      case 'in_review': return 'Send for review';
      case 'approved':  return 'Approve';
      case 'scheduled': return 'Schedule';
      case 'published': return 'Publish';
      case 'archived':  return 'Archive';
      default:          return s;
    }
  }

  return {
    // state
    page,
    loading,
    loadError,
    saving,
    transitioning,
    dirty,
    // editable refs (v-model up to editor body)
    title,
    slug,
    locale,
    htmlInput,
    cssInput,
    layoutTemplate,
    contentMode,
    bodyInput,
    layoutOptions,
    blocksInput,
    seoState,
    // block manifest (dynamic only)
    blockMetas,
    loadingBlockMetas,
    blockMetasError,
    // derived
    statusLabel,
    saveState,
    availableTransitions,
    canPublish,
    // helpers
    transitionLabel,
    // actions
    onSave,
    onTransition,
    onDuplicate,
    onDelete,
    onPreviewInNewTab,
  };
}
