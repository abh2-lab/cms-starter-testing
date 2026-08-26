import { ref } from 'vue';
import {
  taxonomiesApi,
  type Taxonomy,
  type TaxonomyTerm,
} from '@/api/taxonomies';

export interface TaxonomyGroup {
  taxonomy: Taxonomy;
  // Flat list, ordered so children directly follow their parent, each carrying
  // a depth for indentation in the UI.
  terms: (TaxonomyTerm & { depth: number })[];
}

// Module-level cache: the editor often renders the sidebar assigner plus one or
// more taxonomy_relation fields at once, and they all want the same data.
const groups = ref<TaxonomyGroup[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let loaded = false;
let inflight: Promise<void> | null = null;

function orderTerms(terms: TaxonomyTerm[]): (TaxonomyTerm & { depth: number })[] {
  const byParent = new Map<string | null, TaxonomyTerm[]>();
  for (const t of terms) {
    const key = t.parentId ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(t);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  const out: (TaxonomyTerm & { depth: number })[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const t of byParent.get(parentId) ?? []) {
      out.push({ ...t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  // Include any orphans whose parent is missing (defensive).
  if (out.length < terms.length) {
    const seen = new Set(out.map((t) => t.id));
    for (const t of terms) if (!seen.has(t.id)) out.push({ ...t, depth: 0 });
  }
  return out;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const { data: taxonomies } = await taxonomiesApi.list();
    const built = await Promise.all(
      taxonomies.map(async (taxonomy) => {
        const { data: terms } = await taxonomiesApi.listTerms(taxonomy.id);
        return { taxonomy, terms: orderTerms(terms) };
      }),
    );
    groups.value = built;
    loaded = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load taxonomies';
  } finally {
    loading.value = false;
  }
}

export function useTaxonomyTerms() {
  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (!inflight) inflight = load().finally(() => (inflight = null));
    await inflight;
  }

  // Force a fresh fetch (e.g. after creating a term elsewhere).
  async function reload(): Promise<void> {
    loaded = false;
    await ensureLoaded();
  }

  return { groups, loading, error, ensureLoaded, reload };
}
