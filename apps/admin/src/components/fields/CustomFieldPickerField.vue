<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  contentTypesApi,
  type ContentType,
  type FieldDefinition,
} from '@/api/content-types';

// Picker for the block-field type `custom_field`. The block loader reads
// box.detail.customFields[<key>]; here the admin picks that key from a dropdown
// of the surrounding box's content-type fields. The content type slug is
// resolved by BlockFieldsForm (the nearest ancestor box's content_type).
//
// Falls back to a plain text input when no content type is resolvable (e.g. the
// global Block Defaults editor, where there's no box), so the field is never a
// dead end — the admin can still type a field key by hand.

const props = defineProps<{
  modelValue: string;
  // The content type whose custom fields populate the dropdown. Null → text.
  contentTypeSlug: string | null;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

// Module-level cache — content types are stable across a session; one fetch
// covers every picker instance. Mirrors ContentSlugField / useTaxonomyTerms.
let cache: ContentType[] | null = null;
let inflight: Promise<ContentType[]> | null = null;
async function ensureContentTypes(): Promise<ContentType[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = contentTypesApi
      .list()
      .then((r) => {
        cache = r.data;
        return r.data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

const fields = ref<FieldDefinition[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const typeMissing = ref(false);

async function load(): Promise<void> {
  if (!props.contentTypeSlug) {
    fields.value = [];
    typeMissing.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  typeMissing.value = false;
  try {
    const types = await ensureContentTypes();
    const match = types.find((t) => t.slug === props.contentTypeSlug);
    if (!match) {
      typeMissing.value = true;
      fields.value = [];
      return;
    }
    fields.value = [...(match.fieldDefinitions?.fields ?? [])].sort(
      (a, b) => a.order - b.order,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load fields';
  } finally {
    loading.value = false;
  }
}

watch(() => props.contentTypeSlug, load);
onMounted(load);

const valueInList = computed(() =>
  fields.value.some((f) => f.name === props.modelValue),
);
</script>

<template>
  <div class="custom-field-picker">
    <template v-if="contentTypeSlug">
      <select
        :value="modelValue"
        :disabled="loading"
        @change="
          emit('update:modelValue', ($event.target as HTMLSelectElement).value)
        "
      >
        <option value="">
          {{ loading ? 'Loading…' : '— choose a field —' }}
        </option>
        <option v-for="f in fields" :key="f.id" :value="f.name">
          {{ f.label }} ({{ f.type }})
        </option>
        <!-- Keep a saved value that's no longer in the type's field list
             (renamed/removed) visible so saving doesn't silently drop it. -->
        <option v-if="modelValue && !loading && !valueInList" :value="modelValue">
          {{ modelValue }} (not in this content type)
        </option>
      </select>
      <p v-if="error" class="hint hint--error">{{ error }}</p>
      <p v-else-if="typeMissing" class="hint hint--warn">
        Content type <code>{{ contentTypeSlug }}</code> isn't defined yet.
      </p>
      <p
        v-else-if="!loading && fields.length === 0 && !typeMissing"
        class="hint hint--warn"
      >
        <code>{{ contentTypeSlug }}</code> has no custom fields yet — add some
        under Content Types.
      </p>
    </template>

    <!-- No box / content type — degrade to a plain text input. -->
    <template v-else>
      <input
        type="text"
        :value="modelValue"
        :placeholder="placeholder ?? 'place this block inside a box to pick a field'"
        @input="
          emit('update:modelValue', ($event.target as HTMLInputElement).value)
        "
      />
      <p class="hint">
        Add this block inside a Post or Query Loop box to pick from that content
        type's fields.
      </p>
    </template>
  </div>
</template>

<style scoped>
.custom-field-picker {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
select,
input[type='text'] {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
  font-family: inherit;
}
select:focus,
input:focus {
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
