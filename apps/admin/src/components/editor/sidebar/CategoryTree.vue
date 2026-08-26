<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useTaxonomyTerms } from '@/composables/useTaxonomyTerms';

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    // Array shape (canonical, from settings.taxonomies.categories after the
    // many:many binding lands). Multiple category taxonomies can be bound to
    // a content type; this panel lists terms from all of them.
    taxonomySlugs?: string[] | null;
    // Legacy single-slug shape; kept for back-compat with callers that
    // haven't migrated. If both are provided, the array wins.
    taxonomySlug?: string | null;
  }>(),
  { taxonomySlugs: null, taxonomySlug: null },
);
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const { groups, loading, ensureLoaded } = useTaxonomyTerms();

const catGroups = computed(() => {
  if (props.taxonomySlugs && props.taxonomySlugs.length > 0) {
    const set = new Set(props.taxonomySlugs);
    return groups.value.filter((g) => set.has(g.taxonomy.slug));
  }
  if (props.taxonomySlug) {
    return groups.value.filter((g) => g.taxonomy.slug === props.taxonomySlug);
  }
  // Fallback: every category-kind taxonomy. Replaces the old
  // isHierarchical filter, which silently dropped flat-but-category
  // taxonomies (e.g. mill-categories) from this panel.
  return groups.value.filter((g) => g.taxonomy.kind === 'category');
});
const selected = computed(() => new Set(props.modelValue));

function toggle(id: string): void {
  const set = new Set(props.modelValue);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  emit('update:modelValue', [...set]);
}

onMounted(ensureLoaded);
</script>

<template>
  <div class="cat-tree">
    <p v-if="loading" class="muted">Loading…</p>
    <template v-else-if="catGroups.length">
      <template v-for="g in catGroups" :key="g.taxonomy.id">
        <label
          v-for="t in g.terms"
          :key="t.id"
          class="cat-item"
          :style="{ paddingLeft: `${t.depth}rem` }"
        >
          <input
            type="checkbox"
            :checked="selected.has(t.id)"
            @change="toggle(t.id)"
          />
          <span>{{ t.name }}</span>
        </label>
      </template>
    </template>
    <p v-else class="muted">No categories defined.</p>
  </div>
</template>

<style scoped>
.cat-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}
.cat-item:hover {
  color: var(--fg);
}
.cat-item input {
  accent-color: var(--info);
  width: 14px;
  height: 14px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
</style>
