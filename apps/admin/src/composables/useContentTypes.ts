import { ref } from 'vue';
import { contentTypesApi, type ContentType } from '@/api/content-types';

// Module-level cache for the tenant's content-type list. Same shape as
// useTaxonomyTerms — multiple ContentTypeSlugField instances on the same
// page (e.g. several block-binding option fields) share one fetch instead
// of each one re-hitting /admin/content-types.

const items = ref<ContentType[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let loaded = false;
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const { data } = await contentTypesApi.list();
    // Sort alphabetically by name so the picker is browsable; the server
    // returns them in created-at order which isn't useful for a select.
    items.value = [...data].sort((a, b) => a.name.localeCompare(b.name));
    loaded = true;
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Failed to load content types';
  } finally {
    loading.value = false;
  }
}

export function useContentTypes() {
  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (!inflight) inflight = load().finally(() => (inflight = null));
    await inflight;
  }

  // Force a fresh fetch (e.g. after creating a new content type elsewhere
  // in the admin and returning here).
  async function reload(): Promise<void> {
    loaded = false;
    await ensureLoaded();
  }

  return { items, loading, error, ensureLoaded, reload };
}
