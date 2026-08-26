<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { contentApi, type Content } from '@/api/content';
import { contentTypesApi, type ContentType } from '@/api/content-types';

// Picker for the block-field type `content_slug`. The block loader takes a
// (content_type_slug, slug) pair and renders that single content row; here
// we resolve the content_type slug → content_type id (via cached
// contentTypesApi.list) and then query contentApi for published rows of
// that type. The user picks a title, we emit the slug.
//
// Falls back to a plain text input when no content_type is resolvable yet
// (e.g. a fresh block instance before the sibling content_type field has a
// value) so the field never becomes a dead end.

const props = defineProps<{
  modelValue: string;
  // Resolved by the parent BlockFieldsForm: the field's own contentTypeSlug
  // schema attribute, OR the sibling `content_type` field's current value.
  // Null when neither is known — the picker degrades to a text input.
  contentTypeSlug: string | null;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

// ─── Module-level cache for content types (slug → id mapping). ──────────────
// Content types are roughly stable across an admin session; one fetch covers
// every ContentSlugField instance on every page. Mirrors the pattern in
// useTaxonomyTerms.

let contentTypesCache: ContentType[] | null = null;
let contentTypesInflight: Promise<ContentType[]> | null = null;
async function ensureContentTypes(): Promise<ContentType[]> {
  if (contentTypesCache) return contentTypesCache;
  if (!contentTypesInflight) {
    contentTypesInflight = contentTypesApi
      .list()
      .then((r) => {
        contentTypesCache = r.data;
        return r.data;
      })
      .finally(() => {
        contentTypesInflight = null;
      });
  }
  return contentTypesInflight;
}

const options = ref<Content[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const resolvedTypeMissing = ref(false);

async function load(): Promise<void> {
  if (!props.contentTypeSlug) {
    options.value = [];
    resolvedTypeMissing.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  resolvedTypeMissing.value = false;
  try {
    const types = await ensureContentTypes();
    const match = types.find((t) => t.slug === props.contentTypeSlug);
    if (!match) {
      resolvedTypeMissing.value = true;
      options.value = [];
      return;
    }
    const res = await contentApi.list({
      contentTypeId: match.id,
      status: 'published',
      limit: 100,
    });
    // Sort by title for predictable browsing; the API returns by
    // updated_at desc which feels arbitrary for a picker.
    options.value = res.data.slice().sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load content';
  } finally {
    loading.value = false;
  }
}

watch(() => props.contentTypeSlug, load);
onMounted(load);
</script>

<template>
  <div class="content-slug-field">
    <template v-if="contentTypeSlug">
      <select
        :value="modelValue"
        :disabled="loading"
        @change="
          emit(
            'update:modelValue',
            ($event.target as HTMLSelectElement).value,
          )
        "
      >
        <option value="">
          {{ loading ? 'Loading…' : '— choose a story —' }}
        </option>
        <option
          v-for="row in options"
          :key="row.id"
          :value="row.slug"
        >
          {{ row.title }} ({{ row.slug }})
        </option>
        <!-- If the saved value isn't in the published list (draft, archived,
             or just freshly renamed) keep it visible so the form doesn't
             silently drop the binding on next save. -->
        <option
          v-if="
            modelValue &&
            !loading &&
            !options.some((r) => r.slug === modelValue)
          "
          :value="modelValue"
        >
          {{ modelValue }} (not in published list)
        </option>
      </select>
      <p v-if="error" class="hint hint--error">{{ error }}</p>
      <p v-else-if="resolvedTypeMissing" class="hint hint--warn">
        Content type <code>{{ contentTypeSlug }}</code> isn't defined yet —
        create it under Content Types or pick a different one above.
      </p>
      <p
        v-else-if="!loading && options.length === 0 && !resolvedTypeMissing"
        class="hint hint--warn"
      >
        No published rows for <code>{{ contentTypeSlug }}</code> yet.
      </p>
    </template>

    <!-- No content_type resolved — fall back to a plain text input so the
         field is never a dead end. The admin can still type a slug manually
         and fill in content_type later. -->
    <template v-else>
      <input
        type="text"
        :value="modelValue"
        :placeholder="placeholder ?? 'set content_type first to pick from a list'"
        @input="
          emit(
            'update:modelValue',
            ($event.target as HTMLInputElement).value,
          )
        "
      />
      <p class="hint">
        Set the content type above first to pick from a list of published
        rows.
      </p>
    </template>
  </div>
</template>

<style scoped>
.content-slug-field {
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
