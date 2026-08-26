<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useTaxonomyTerms } from '@/composables/useTaxonomyTerms';

const props = defineProps<{
  modelValue: unknown;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const { groups, loading, error, ensureLoaded } = useTaxonomyTerms();
const filter = ref('');

const selected = computed<string[]>(() =>
  Array.isArray(props.modelValue)
    ? props.modelValue.filter((x): x is string => typeof x === 'string')
    : [],
);

const visibleGroups = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return groups.value
    .map((g) => ({
      taxonomy: g.taxonomy,
      terms: q
        ? g.terms.filter((t) => t.name.toLowerCase().includes(q))
        : g.terms,
    }))
    .filter((g) => g.terms.length > 0);
});

function toggle(id: string): void {
  const set = new Set(selected.value);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  emit('update:modelValue', [...set]);
}

onMounted(ensureLoaded);
</script>

<template>
  <div class="term-picker">
    <p v-if="loading" class="muted">Loading taxonomies…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="groups.length === 0" class="muted">
      No taxonomies defined yet.
    </p>

    <template v-else>
      <input
        v-model="filter"
        type="search"
        class="filter"
        placeholder="Filter terms…"
      />
      <div class="groups">
        <section v-for="g in visibleGroups" :key="g.taxonomy.id" class="group">
          <h4 class="group-name">{{ g.taxonomy.name }}</h4>
          <label
            v-for="t in g.terms"
            :key="t.id"
            class="term"
            :style="{ paddingLeft: `${t.depth * 1}rem` }"
          >
            <input
              type="checkbox"
              :checked="selected.includes(t.id)"
              @change="toggle(t.id)"
            />
            <span>{{ t.name }}</span>
          </label>
        </section>
        <p v-if="visibleGroups.length === 0" class="muted">No matching terms.</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.term-picker {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.filter {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.8125rem;
}
.groups {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  max-height: 16rem;
  overflow-y: auto;
}
.group-name {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.term {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  padding: 0.1875rem 0;
  cursor: pointer;
}
.muted {
  color: var(--muted);
  font-size: 0.8125rem;
}
.error {
  color: #dc2626;
  font-size: 0.8125rem;
}
</style>
