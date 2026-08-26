<script setup lang="ts">
import type { FieldDefinition } from '@/api/content-types';
import MediaField from '@/components/fields/MediaField.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    slug: string;
    slugPrefix: string;
    excerptField: FieldDefinition | null;
    featuredImageField: FieldDefinition | null;
    getField: (name: string) => unknown;
    setField: (name: string, value: unknown) => void;
    // Map of field path → server-side validation message. Mirrors the prop
    // shape used by CustomFieldsEditor so the banner's Go-to-field button can
    // scroll here when the offending field is body/excerpt/featured_image.
    validationErrors?: Record<string, string>;
  }>(),
  { validationErrors: () => ({}) },
);

const emit = defineEmits<{
  'update:title': [value: string];
  'update:slug': [value: string];
}>();

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
</script>

<template>
  <div class="surface">
    <div
      v-if="featuredImageField"
      class="featured"
      :class="{
        'field--invalid': props.validationErrors[featuredImageField.name],
      }"
      :data-field-path="featuredImageField.name"
    >
      <span class="featured-label">{{ featuredImageField.label }}</span>
      <MediaField
        :multiple="false"
        :model-value="props.getField(featuredImageField.name)"
        @update:model-value="
          (v: unknown) => props.setField(featuredImageField!.name, v)
        "
      />
      <p
        v-if="props.validationErrors[featuredImageField.name]"
        class="surface-error"
        role="alert"
      >
        {{ props.validationErrors[featuredImageField.name] }}
      </p>
    </div>

    <textarea
      class="title-input"
      rows="1"
      placeholder="Post title…"
      maxlength="500"
      :value="title"
      @input="emit('update:title', ($event.target as HTMLTextAreaElement).value)"
    />

    <div class="slug-row">
      <span class="slug-prefix">{{ slugPrefix }}</span>
      <input
        class="slug-value"
        type="text"
        pattern="[a-z0-9][a-z0-9\-]*"
        maxlength="255"
        :value="slug"
        @input="emit('update:slug', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div
      v-if="excerptField"
      :class="{
        'excerpt-wrap': true,
        'field--invalid': props.validationErrors[excerptField.name],
      }"
      :data-field-path="excerptField.name"
    >
      <textarea
        class="excerpt-input"
        rows="2"
        :placeholder="`${excerptField.label}…`"
        :value="asString(props.getField(excerptField.name))"
        @input="
          props.setField(
            excerptField!.name,
            ($event.target as HTMLTextAreaElement).value,
          )
        "
      />
      <p
        v-if="props.validationErrors[excerptField.name]"
        class="surface-error"
        role="alert"
      >
        {{ props.validationErrors[excerptField.name] }}
      </p>
    </div>

    <div class="surface-divider" />

    <slot />
  </div>
</template>

<style scoped>
.surface {
  display: flex;
  flex-direction: column;
}
.featured {
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.featured-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.title-input {
  border: none;
  outline: none;
  width: 100%;
  resize: none;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.25;
  margin-bottom: 12px;
  field-sizing: content;
}
.title-input::placeholder {
  color: var(--text-tertiary);
  opacity: 0.6;
}
.slug-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 16px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border-soft);
}
.slug-prefix {
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, monospace;
  white-space: nowrap;
}
.slug-value {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--info);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
}
.excerpt-input {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--muted);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  font-style: italic;
  field-sizing: content;
}
.excerpt-input::placeholder {
  color: var(--text-tertiary);
  opacity: 0.6;
  font-style: italic;
}
.surface-divider {
  width: 40px;
  height: 1px;
  background: var(--border);
  margin: 18px 0 24px;
}
.field--invalid .excerpt-input,
.field--invalid :deep(.media-field) {
  outline: 1px solid var(--danger, #dc2626);
  outline-offset: 4px;
  border-radius: 4px;
}
.surface-error {
  margin: 0.375rem 0 0;
  color: var(--danger, #dc2626);
  font-size: 0.8125rem;
  font-weight: 500;
}
</style>
