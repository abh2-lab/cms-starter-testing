<script setup lang="ts">
import { computed, ref } from 'vue';
import MediaPickerModal from './MediaPickerModal.vue';
import type { Media } from '@/api/media';

// Stores an S3 storage *key* (what site_settings columns hold), unlike
// MediaField which stores a media id. previewUrl is the resolved display URL the
// API returns for the already-saved key.
const props = defineProps<{
  modelValue: string;
  previewUrl?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const pickerOpen = ref(false);
// When the user picks a new file we get its url directly; prefer it over the
// server-provided previewUrl (which reflects the previously-saved key).
const pickedUrl = ref<string | null>(null);

const preview = computed<string | null>(() => {
  if (!props.modelValue) return null;
  return pickedUrl.value ?? props.previewUrl ?? null;
});

function onSelect(chosen: Media[]): void {
  const media = chosen[0];
  if (media) {
    pickedUrl.value = media.url;
    emit('update:modelValue', media.storageKey);
  }
  pickerOpen.value = false;
}

function clear(): void {
  pickedUrl.value = null;
  emit('update:modelValue', '');
}
</script>

<template>
  <div class="media-key-field">
    <div v-if="modelValue" class="current">
      <div class="thumb">
        <img v-if="preview" :src="preview" alt="" />
        <span v-else class="ext">IMG</span>
      </div>
      <code class="key">{{ modelValue }}</code>
      <button type="button" class="remove" aria-label="Remove" title="Remove" @click="clear">✕</button>
    </div>

    <button type="button" class="btn-pick" @click="pickerOpen = true">
      {{ modelValue ? 'Replace' : 'Choose image' }}
    </button>

    <MediaPickerModal
      v-if="pickerOpen"
      :multiple="false"
      @select="onSelect"
      @close="pickerOpen = false"
    />
  </div>
</template>

<style scoped>
.media-key-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.current {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
}
.thumb {
  width: 44px;
  height: 44px;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ext {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: var(--muted);
  font-weight: 600;
}
.key {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remove {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  flex-shrink: 0;
}
.remove:hover {
  color: var(--danger);
}
.btn-pick {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}
.btn-pick:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
