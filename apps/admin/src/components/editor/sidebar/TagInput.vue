<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import { useTaxonomyTerms } from '@/composables/useTaxonomyTerms';

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    // Array shape (canonical, from settings.taxonomies.tags after the
    // many:many binding lands). When set, only these taxonomies' terms
    // appear; otherwise fall back to every tag-kind taxonomy.
    taxonomySlugs?: string[] | null;
    // Legacy single-slug shape; kept for back-compat. Array wins if both
    // are provided.
    taxonomySlug?: string | null;
    // No longer used now that CategoryTree filters by kind='category'; kept
    // as an accepted-but-ignored prop for back-compat with parents that
    // still pass it. Safe to drop in a future cleanup pass.
    categoryTaxonomySlug?: string | null;
  }>(),
  { taxonomySlugs: null, taxonomySlug: null, categoryTaxonomySlug: null },
);
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const { groups, ensureLoaded } = useTaxonomyTerms();
const filter = ref('');

const tagGroups = computed(() => {
  if (props.taxonomySlugs && props.taxonomySlugs.length > 0) {
    const set = new Set(props.taxonomySlugs);
    return groups.value.filter((g) => set.has(g.taxonomy.slug));
  }
  if (props.taxonomySlug) {
    return groups.value.filter((g) => g.taxonomy.slug === props.taxonomySlug);
  }
  // Fallback: every tag-kind taxonomy. With explicit kind we no longer
  // need to subtract categoryTaxonomySlug — a flat category is now
  // kind='category' and naturally excluded from this filter.
  return groups.value.filter((g) => g.taxonomy.kind === 'tag');
});
const allTags = computed(() => tagGroups.value.flatMap((g) => g.terms));
const labelById = computed(() => {
  const m = new Map<string, string>();
  for (const t of allTags.value) m.set(t.id, t.name);
  return m;
});
// Only the assigned ids that belong to a tag taxonomy (the array also holds
// category ids, which CategoryTree owns).
const selectedTagIds = computed(() =>
  props.modelValue.filter((id) => labelById.value.has(id)),
);

const suggestions = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const sel = new Set(props.modelValue);
  return allTags.value
    .filter((t) => !sel.has(t.id) && (!q || t.name.toLowerCase().includes(q)))
    .slice(0, 8);
});

function add(id: string): void {
  if (props.modelValue.includes(id)) return;
  emit('update:modelValue', [...props.modelValue, id]);
  filter.value = '';
}
function remove(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((x) => x !== id),
  );
}

onMounted(ensureLoaded);
</script>

<template>
  <div class="tag-input">
    <ul v-if="selectedTagIds.length" class="chips">
      <li v-for="id in selectedTagIds" :key="id" class="chip">
        {{ labelById.get(id) }}
        <button
          type="button"
          class="chip-x"
          aria-label="Remove tag"
          @click="remove(id)"
        >
          <Icon name="x" :size="11" />
        </button>
      </li>
    </ul>
    <input
      v-model="filter"
      type="search"
      class="form-input"
      placeholder="Filter tags…"
    />
    <ul v-if="suggestions.length" class="suggestions">
      <li v-for="t in suggestions" :key="t.id">
        <button type="button" class="suggestion" @click="add(t.id)">
          + {{ t.name }}
        </button>
      </li>
    </ul>
    <p v-else-if="allTags.length" class="muted">No matching tags.</p>
    <p v-else class="muted">No tags defined.</p>
  </div>
</template>

<style scoped>
.tag-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 3px 6px 3px 10px;
  font-size: 12px;
  color: var(--muted);
}
.chip-x {
  display: inline-flex;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
}
.chip-x:hover {
  color: var(--danger);
}
.suggestions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.suggestion {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  font-family: inherit;
}
.suggestion:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
</style>
