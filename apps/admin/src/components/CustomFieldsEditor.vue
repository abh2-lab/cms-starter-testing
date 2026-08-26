<script setup lang="ts">
import { computed } from 'vue';
import type { FieldDefinitions } from '@/api/content-types';
import RichTextEditor from './RichTextEditor.vue';
import MediaField from './fields/MediaField.vue';
import ContentRelationField from './fields/ContentRelationField.vue';
import RepeaterField from './fields/RepeaterField.vue';
import TermPicker from './TermPicker.vue';

const props = withDefaults(
  defineProps<{
    fieldDefinitions: FieldDefinitions;
    modelValue: Record<string, unknown>;
    // Map of field path → server-side validation message. Populated by the
    // parent editor when a publish/save attempt returns 422 with issues. Each
    // field row renders a red border + the matching message below the input.
    validationErrors?: Record<string, string>;
  }>(),
  { validationErrors: () => ({}) },
);

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>];
}>();

// Render in declared order.
const fields = computed(() =>
  [...props.fieldDefinitions.fields].sort((a, b) => a.order - b.order),
);

function setField(name: string, value: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [name]: value });
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asNumberOrEmpty(v: unknown): number | string {
  return typeof v === 'number' && !Number.isNaN(v) ? v : '';
}
function asBoolean(v: unknown): boolean {
  return v === true;
}
function asObjectOrNull(v: unknown): object | null {
  return v && typeof v === 'object' ? v : null;
}
function toJsonString(v: unknown): string {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}
function parseJsonOrPassthrough(s: string): unknown {
  if (s.trim() === '') return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
</script>

<template>
  <div class="fields">
    <div
      v-for="field in fields"
      :key="field.name"
      class="field"
      :class="{ 'field--invalid': props.validationErrors[field.name] }"
      :data-field-path="field.name"
    >
      <label>
        <span class="field-label">
          {{ field.label }}
          <span v-if="field.required" class="required" aria-label="required">*</span>
          <small class="field-key">{{ field.name }}</small>
        </span>
        <small v-if="field.helpText" class="help">{{ field.helpText }}</small>

        <input
          v-if="field.type === 'short_text'"
          type="text"
          :value="asString(modelValue[field.name])"
          @input="setField(field.name, ($event.target as HTMLInputElement).value)"
        />

        <textarea
          v-else-if="field.type === 'long_text'"
          rows="4"
          :value="asString(modelValue[field.name])"
          @input="setField(field.name, ($event.target as HTMLTextAreaElement).value)"
        />

        <RichTextEditor
          v-else-if="field.type === 'rich_text'"
          :model-value="asObjectOrNull(modelValue[field.name])"
          :placeholder="`Write ${field.label.toLowerCase()}…`"
          @update:model-value="(v: object) => setField(field.name, v)"
        />

        <input
          v-else-if="field.type === 'number'"
          type="number"
          :value="asNumberOrEmpty(modelValue[field.name])"
          @input="setField(field.name, ($event.target as HTMLInputElement).valueAsNumber)"
        />

        <label v-else-if="field.type === 'boolean'" class="checkbox">
          <input
            type="checkbox"
            :checked="asBoolean(modelValue[field.name])"
            @change="setField(field.name, ($event.target as HTMLInputElement).checked)"
          />
          <span>Enabled</span>
        </label>

        <input
          v-else-if="field.type === 'date'"
          type="date"
          :value="asString(modelValue[field.name])"
          @input="setField(field.name, ($event.target as HTMLInputElement).value)"
        />

        <input
          v-else-if="field.type === 'datetime'"
          type="datetime-local"
          :value="asString(modelValue[field.name])"
          @input="setField(field.name, ($event.target as HTMLInputElement).value)"
        />

        <select
          v-else-if="field.type === 'select'"
          :value="asString(modelValue[field.name])"
          @change="setField(field.name, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">— none —</option>
          <option
            v-for="opt in field.validations?.options ?? []"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>

        <textarea
          v-else-if="field.type === 'json_raw'"
          class="code"
          rows="6"
          spellcheck="false"
          :value="toJsonString(modelValue[field.name])"
          @input="
            setField(
              field.name,
              parseJsonOrPassthrough(($event.target as HTMLTextAreaElement).value),
            )
          "
        />

        <MediaField
          v-else-if="field.type === 'media_single'"
          :multiple="false"
          :model-value="modelValue[field.name]"
          @update:model-value="(v: unknown) => setField(field.name, v)"
        />

        <MediaField
          v-else-if="field.type === 'media_gallery'"
          :multiple="true"
          :model-value="modelValue[field.name]"
          @update:model-value="(v: unknown) => setField(field.name, v)"
        />

        <ContentRelationField
          v-else-if="field.type === 'content_relation'"
          :model-value="modelValue[field.name]"
          @update:model-value="(v: string[]) => setField(field.name, v)"
        />

        <TermPicker
          v-else-if="field.type === 'taxonomy_relation'"
          :model-value="modelValue[field.name]"
          @update:model-value="(v: string[]) => setField(field.name, v)"
        />

        <RepeaterField
          v-else-if="field.type === 'repeater'"
          :sub-fields="field.subFields ?? []"
          :model-value="modelValue[field.name]"
          @update:model-value="(v: unknown[]) => setField(field.name, v)"
        />
      </label>
      <p
        v-if="props.validationErrors[field.name]"
        class="field-error"
        role="alert"
      >
        {{ props.validationErrors[field.name] }}
      </p>
    </div>

    <p v-if="fields.length === 0" class="muted">
      No custom fields defined for this content type.
    </p>
  </div>
</template>

<style scoped>
.fields {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.field > label {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.field-label {
  font-size: 0.875rem;
  font-weight: 500;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.required {
  color: #dc2626;
}
.field-key {
  color: var(--muted);
  font-weight: 400;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.75rem;
}
.help {
  color: var(--muted);
  font-size: 0.75rem;
}
.field input[type='text'],
.field input[type='number'],
.field input[type='date'],
.field input[type='datetime-local'],
.field select,
.field textarea {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: 0.9375rem;
}
.field textarea.code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.8125rem;
}
.checkbox {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 0.5rem;
}
.muted {
  color: var(--muted);
}
.field--invalid input[type='text'],
.field--invalid input[type='number'],
.field--invalid input[type='date'],
.field--invalid input[type='datetime-local'],
.field--invalid select,
.field--invalid textarea {
  border-color: var(--danger, #dc2626);
  box-shadow: 0 0 0 1px var(--danger, #dc2626) inset;
}
.field-error {
  margin: 0.25rem 0 0;
  color: var(--danger, #dc2626);
  font-size: 0.8125rem;
  font-weight: 500;
}
</style>
