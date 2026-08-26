import { cmsFetch } from '~/composables/useCmsFetch';
import type { ComposedBlock } from '~/composables/useBlockRegistry';

// Composed system-page view (theme engine v2 Phase 4): the override-backed
// block tree for /404, /search, /authors, /contact. Mirrors useCmsPart —
// forwards ?theme_preview so the structure editor's iframe renders the DRAFT,
// and keys the cache on the token so a live request and a preview never share
// a cache entry.

export interface SystemViewPayload {
  role: string;
  blocks: ComposedBlock[];
}

export const useSystemView = (role: string) => {
  const route = useRoute();
  const themePreview = computed<string | null>(() => {
    const raw = route.query['theme_preview'];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  });
  return useAsyncData(
    () => `cms:system:${role}:${themePreview.value ?? 'live'}`,
    () =>
      cmsFetch<SystemViewPayload>(
        `/api/public/views/system/${encodeURIComponent(role)}`,
        themePreview.value ? { theme_preview: themePreview.value } : undefined,
      ),
    { watch: [themePreview] },
  );
};
