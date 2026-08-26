<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useTaxonomyTerms } from '@/composables/useTaxonomyTerms';

// Picker for the block-field type `category_slug`. The block loaders treat
// the value as a taxonomy term slug — the public render filters content by
// that term. We use the existing useTaxonomyTerms composable so the data is
// cached across every CategorySlugField instance on the page.
//
// When the field schema pins a `taxonomySlug`, only that taxonomy's terms
// are shown. Otherwise we group terms by taxonomy in an <optgroup> so the
// admin can disambiguate "politics (categories)" from "politics (tags)".

const props = defineProps<{
  modelValue: string;
  // From BlockField.taxonomySlug — restricts the picker to one taxonomy.
  // Null/undefined means "pick from any taxonomy".
  taxonomySlug: string | null;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { groups, loading, error, ensureLoaded } = useTaxonomyTerms();

onMounted(ensureLoaded);

const filteredGroups = computed(() => {
  if (!props.taxonomySlug) return groups.value;
  return groups.value.filter((g) => g.taxonomy.slug === props.taxonomySlug);
});

const missingTaxonomy = computed(
  () =>
    props.taxonomySlug !== null &&
    props.taxonomySlug !== '' &&
    !loading.value &&
    filteredGroups.value.length === 0,
);
</script>

<template>
  <div class="category-slug-field">
    <select
      :value="modelValue"
      :disabled="loading"
      @change="
        emit('update:modelValue', ($event.target as HTMLSelectElement).value)
      "
    >
      <option value="">
        {{ loading ? 'Loading…' : '— choose a category —' }}
      </option>
      <template v-if="taxonomySlug">
        <option
          v-for="term in filteredGroups[0]?.terms ?? []"
          :key="term.id"
          :value="term.slug"
        >
          <template v-for="_ in term.depth" :key="_">— </template>{{ term.name }}
        </option>
      </template>
      <template v-else>
        <optgroup
          v-for="g in filteredGroups"
          :key="g.taxonomy.id"
          :label="g.taxonomy.name"
        >
          <option
            v-for="term in g.terms"
            :key="term.id"
            :value="term.slug"
          >
            <template v-for="_ in term.depth" :key="_">— </template>{{ term.name }}
          </option>
        </optgroup>
      </template>
      <!-- Preserve a manually-typed / previously-saved value that's no
           longer in the taxonomy list (renamed, deleted). Otherwise saving
           would silently drop the binding. -->
      <option
        v-if="
          modelValue &&
          !loading &&
          !filteredGroups.some((g) =>
            g.terms.some((t) => t.slug === modelValue),
          )
        "
        :value="modelValue"
      >
        {{ modelValue }} (not in taxonomy)
      </option>
    </select>
    <p v-if="error" class="hint hint--error">{{ error }}</p>
    <p v-else-if="missingTaxonomy" class="hint hint--warn">
      Taxonomy <code>{{ taxonomySlug }}</code> doesn't exist yet — create it
      under Taxonomies or remove the restriction in the block definition.
    </p>
  </div>
</template>

<style scoped>
.category-slug-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
select {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
  font-family: inherit;
}
select:focus {
  outline: none;
  border-color: var(--accent);
}
.hint {
  margin: 0.125rem 0 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary, var(--muted));
  line-height: 1.4;
}
.hint--warn {
  color: #92400e;
}
.hint--error {
  color: #dc2626;
}
.hint code {
  background: rgba(0, 0, 0, 0.06);
  padding: 0 0.25rem;
  border-radius: 0.1875rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
</style>
