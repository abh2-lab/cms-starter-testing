<script setup lang="ts">
// Field block: renders ONE chosen custom field of the current post. The loader
// (packages/blocks/src/blocks/custom-field.ts) delivers the resolved value plus
// the field's declared type so we can format it: rich text via ContentBody
// (TipTap), media as image(s), everything else as text. Renders nothing when
// there's no value (no box, empty field) — matching the other field blocks.
import { computed } from 'vue';

interface Data {
  value: unknown;
  fieldType: string | null;
  label: string | null;
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

// Scalar fallback for non-rich-text / non-media types (text, number, date,
// select, boolean, json_raw, relations). Booleans read nicer than "true".
const display = computed<string>(() => {
  const v = props.data?.value;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  // Objects/arrays (json_raw, relations) — show the raw JSON rather than
  // the useless "[object Object]" default stringification.
  return JSON.stringify(v);
});

const galleryUrls = computed<string[]>(() => {
  const v = props.data?.value;
  return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string') : [];
});
</script>

<template>
  <ContentBody
    v-if="data && data.fieldType === 'rich_text' && data.value"
    :doc="data.value"
  />
  <img
    v-else-if="
      data && data.fieldType === 'media_single' && typeof data.value === 'string'
    "
    class="cms-custom-field__media"
    :src="data.value"
    :alt="data.label ?? ''"
    loading="lazy"
  />
  <div
    v-else-if="data && data.fieldType === 'media_gallery' && galleryUrls.length"
    class="cms-custom-field__gallery"
  >
    <img
      v-for="(url, i) in galleryUrls"
      :key="i"
      :src="url"
      :alt="data.label ?? ''"
      loading="lazy"
    />
  </div>
  <span v-else-if="display" class="cms-custom-field__text">{{ display }}</span>
</template>

<style scoped>
.cms-custom-field__media,
.cms-custom-field__gallery img {
  max-width: 100%;
  height: auto;
}
.cms-custom-field__gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
