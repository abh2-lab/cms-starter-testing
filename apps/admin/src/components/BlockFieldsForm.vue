<script setup lang="ts">
import { computed } from 'vue';
import type { BlockField } from '@/api/pages';
import ContentSlugField from '@/components/fields/ContentSlugField.vue';
import ContentTypeSlugField from '@/components/fields/ContentTypeSlugField.vue';
import CategorySlugField from '@/components/fields/CategorySlugField.vue';
import CustomFieldPickerField from '@/components/fields/CustomFieldPickerField.vue';
import MediaField from '@/components/fields/MediaField.vue';

// Renders an editable form for a block's fields[] OR options[] array. The
// caller passes the schema (a BlockField[]) and a values record; we emit
// updated values whenever the user types. This is the admin-side counterpart
// to the per-type input switch inside @cms/blocks — keep the supported
// `BlockFieldType` values in sync with the type definition in @cms/blocks.
//
// Inputs:
//  - short_text / url / long_text / number → plain HTML inputs
//  - boolean → checkbox
//  - select → dropdown driven by field.options
//  - content_slug → ContentSlugField picker, resolving the sibling
//    `content_type` field's value into a content-type id, then listing
//    published rows of that type. Falls back to a plain text input if
//    content_type is empty.
//  - category_slug → CategorySlugField picker, sourcing terms via the
//    shared useTaxonomyTerms cache.
//  - kv_list → repeater of {label, value} rows with add/remove
//  - media_single / media_gallery → MediaField (the media-library picker, the
//    same one CustomFieldsEditor uses for content fields). Stores media row
//    ID(s), never a URL — object URLs are presigned and expire, so a block's
//    loader resolves the id via ctx.resolveMediaUrl() at render time.

const props = withDefaults(
  defineProps<{
    schema: BlockField[];
    values: Record<string, unknown>;
    // Callers that render their own field labels (type/binding badges, etc.)
    // can pass hideLabels=true to suppress the bare labels this form would
    // otherwise draw. Default false keeps standard call sites unchanged.
    hideLabels?: boolean;
    // The content-type slug a `custom_field` picker should list fields from —
    // the nearest ancestor box's content type, supplied by the editor. Null in
    // contexts with no box (e.g. the global Block Defaults editor), where the
    // picker degrades to a text input.
    ancestorContentTypeSlug?: string | null;
  }>(),
  { hideLabels: false, ancestorContentTypeSlug: null },
);

const emit = defineEmits<{
  (event: 'update', next: Record<string, unknown>): void;
}>();

function set(key: string, value: unknown): void {
  emit('update', { ...props.values, [key]: value });
}

// Per-field helpers so each input binds cleanly without typing gymnastics.
function strOf(key: string): string {
  const v = props.values[key];
  return typeof v === 'string' ? v : '';
}
function numOf(key: string): number | '' {
  const v = props.values[key];
  return typeof v === 'number' ? v : '';
}
function boolOf(key: string): boolean {
  return Boolean(props.values[key]);
}

// kv_list helpers — typed array of {label, value}.
interface KvRow { label: string; value: string }
function kvOf(key: string): KvRow[] {
  const v = props.values[key];
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (r): r is KvRow =>
        !!r &&
        typeof (r as KvRow).label === 'string' &&
        typeof (r as KvRow).value === 'string',
    )
    .map((r) => ({ label: r.label, value: r.value }));
}
function setKvRow(key: string, idx: number, patch: Partial<KvRow>): void {
  const list = kvOf(key).slice();
  const current = list[idx] ?? { label: '', value: '' };
  list[idx] = { ...current, ...patch };
  set(key, list);
}
function addKvRow(key: string): void {
  set(key, [...kvOf(key), { label: '', value: '' }]);
}
function removeKvRow(key: string, idx: number): void {
  const list = kvOf(key).slice();
  list.splice(idx, 1);
  set(key, list);
}

const sortedSchema = computed(() => [...props.schema]);

// content_slug pickers need a content type to filter the list. The block
// schema may pin one via field.contentTypeSlug, or the admin may set a
// sibling `content_type` short_text field. Returns null when neither
// resolves; the picker degrades to a text input in that case.
function resolveContentTypeSlug(field: BlockField): string | null {
  if (field.contentTypeSlug) return field.contentTypeSlug;
  const sibling = props.values['content_type'];
  return typeof sibling === 'string' && sibling.length > 0 ? sibling : null;
}

// custom_field pickers list the fields of the surrounding box's content type.
// A schema-pinned contentTypeSlug wins; otherwise use the ancestor box's type
// (passed down by the editor). Null → the picker degrades to a text input.
function customFieldContentType(field: BlockField): string | null {
  return field.contentTypeSlug ?? props.ancestorContentTypeSlug;
}
</script>

<template>
  <div class="block-fields">
    <div v-for="field in sortedSchema" :key="field.key" class="field">
      <label
        v-if="field.type !== 'boolean' && !props.hideLabels"
        class="label"
      >
        {{ field.label }}
        <span v-if="field.required" class="req">*</span>
      </label>

      <!-- short_text + url — single-line input -->
      <input
        v-if="['short_text', 'url'].includes(field.type)"
        :type="field.type === 'url' ? 'url' : 'text'"
        :value="strOf(field.key)"
        :placeholder="(field.default as string) ?? ''"
        @input="(e) => set(field.key, (e.target as HTMLInputElement).value)"
      />

      <!-- content_slug — picker over published rows of the matching content type -->
      <ContentSlugField
        v-else-if="field.type === 'content_slug'"
        :model-value="strOf(field.key)"
        :content-type-slug="resolveContentTypeSlug(field)"
        :placeholder="(field.default as string) ?? ''"
        @update:model-value="(v: string) => set(field.key, v)"
      />

      <!-- content_type_slug — picker over the tenant's content types -->
      <ContentTypeSlugField
        v-else-if="field.type === 'content_type_slug'"
        :model-value="strOf(field.key)"
        :placeholder="(field.default as string) ?? ''"
        @update:model-value="(v: string) => set(field.key, v)"
      />

      <!-- category_slug — picker over taxonomy terms (optgroup'd by taxonomy) -->
      <CategorySlugField
        v-else-if="field.type === 'category_slug'"
        :model-value="strOf(field.key)"
        :taxonomy-slug="field.taxonomySlug ?? null"
        :placeholder="(field.default as string) ?? ''"
        @update:model-value="(v: string) => set(field.key, v)"
      />

      <!-- custom_field — picker over the ancestor box's content-type fields -->
      <CustomFieldPickerField
        v-else-if="field.type === 'custom_field'"
        :model-value="strOf(field.key)"
        :content-type-slug="customFieldContentType(field)"
        :placeholder="(field.default as string) ?? ''"
        @update:model-value="(v: string) => set(field.key, v)"
      />

      <!-- long_text — multi-line -->
      <textarea
        v-else-if="field.type === 'long_text'"
        :value="strOf(field.key)"
        rows="3"
        :placeholder="(field.default as string) ?? ''"
        @input="(e) => set(field.key, (e.target as HTMLTextAreaElement).value)"
      />

      <!-- number — bounded -->
      <input
        v-else-if="field.type === 'number'"
        type="number"
        :min="field.min"
        :max="field.max"
        :value="numOf(field.key)"
        @input="(e) => {
          const v = (e.target as HTMLInputElement).value;
          set(field.key, v === '' ? undefined : Number(v));
        }"
      />

      <!-- boolean -->
      <label v-else-if="field.type === 'boolean'" class="checkbox">
        <input
          type="checkbox"
          :checked="boolOf(field.key)"
          @change="(e) => set(field.key, (e.target as HTMLInputElement).checked)"
        />
        <span>{{ field.label }}</span>
      </label>

      <!-- select -->
      <select
        v-else-if="field.type === 'select'"
        :value="strOf(field.key)"
        @change="(e) => set(field.key, (e.target as HTMLSelectElement).value)"
      >
        <option value="">— choose —</option>
        <option v-for="opt in field.options ?? []" :key="opt" :value="opt">
          {{ opt }}
        </option>
      </select>

      <!-- kv_list — repeater of {label, value} rows -->
      <div v-else-if="field.type === 'kv_list'" class="kv-list">
        <div
          v-for="(row, idx) in kvOf(field.key)"
          :key="idx"
          class="kv-row"
        >
          <input
            type="text"
            placeholder="Label"
            :value="row.label"
            @input="(e) => setKvRow(field.key, idx, { label: (e.target as HTMLInputElement).value })"
          />
          <input
            type="text"
            placeholder="Value"
            :value="row.value"
            @input="(e) => setKvRow(field.key, idx, { value: (e.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            aria-label="Remove row"
            @click="removeKvRow(field.key, idx)"
          >
            ×
          </button>
        </div>
        <button
          type="button"
          class="btn btn--small"
          @click="addKvRow(field.key)"
        >
          + Add row
        </button>
      </div>

      <!-- media_single / media_gallery — the shared media-library picker.
           Holds media row ID(s); the block's loader turns them into URLs. -->
      <MediaField
        v-else-if="field.type === 'media_single'"
        :multiple="false"
        :model-value="values[field.key]"
        @update:model-value="(v: unknown) => set(field.key, v)"
      />

      <MediaField
        v-else-if="field.type === 'media_gallery'"
        :multiple="true"
        :model-value="values[field.key]"
        @update:model-value="(v: unknown) => set(field.key, v)"
      />

      <p v-if="field.helpText" class="help">{{ field.helpText }}</p>
    </div>
  </div>
</template>

<style scoped>
.block-fields {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.req {
  color: #dc2626;
  margin-left: 0.125rem;
}
input[type='text'],
input[type='url'],
input[type='number'],
textarea,
select {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
  font-family: inherit;
}
input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: var(--accent);
}
.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}
.help {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 0.125rem 0 0;
}
.kv-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.kv-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.5rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--surface);
  color: var(--fg);
  font-size: 0.8125rem;
  cursor: pointer;
  align-self: flex-start;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.btn--small {
  font-size: 0.75rem;
  padding: 0.25rem 0.625rem;
}
.icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.icon-btn:hover {
  border-color: var(--accent);
}
.icon-btn--danger:hover {
  color: #dc2626;
  border-color: #dc2626;
}
</style>
