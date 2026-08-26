<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useContentTypes } from '@/composables/useContentTypes';

// Picker for the block-field type `content_type_slug`. The block loaders
// treat the value as a content type slug (e.g. 'article') — the public
// render uses it to fetch from the matching content type's published rows.
// We use the useContentTypes composable so the list is cached across every
// ContentTypeSlugField instance on the page (a block with both a Hero and a
// Featured Article binding renders this picker twice).
//
// Stale-value preservation: if a persisted slug is no longer present in the
// list (the content type was renamed or deleted), we still render it as an
// option labelled "(not in list)" so saving doesn't silently drop the
// binding — same pattern as CategorySlugField.

defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { items, loading, error, ensureLoaded } = useContentTypes();

onMounted(ensureLoaded);

const sortedItems = computed(() => items.value);
</script>

<template>
  <div class="content-type-slug-field">
    <select
      :value="modelValue"
      :disabled="loading"
      @change="
        emit('update:modelValue', ($event.target as HTMLSelectElement).value)
      "
    >
      <option value="">
        {{ loading ? 'Loading…' : '— choose a content type —' }}
      </option>
      <option
        v-for="ct in sortedItems"
        :key="ct.id"
        :value="ct.slug"
      >
        {{ ct.name }}
      </option>
      <!-- Preserve a previously-saved value that's no longer in the list
           (renamed, deleted). Otherwise saving would silently drop the
           binding. -->
      <option
        v-if="
          modelValue &&
          !loading &&
          !sortedItems.some((ct) => ct.slug === modelValue)
        "
        :value="modelValue"
      >
        {{ modelValue }} (not in list)
      </option>
    </select>
    <p v-if="error" class="hint hint--error">{{ error }}</p>
  </div>
</template>

<style scoped>
.content-type-slug-field {
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
.hint--error {
  color: #dc2626;
}
</style>
