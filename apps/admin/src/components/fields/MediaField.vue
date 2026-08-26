<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { mediaApi, type Media } from '@/api/media';
import MediaPickerModal from '../MediaPickerModal.vue';

const props = defineProps<{
  modelValue: unknown;
  multiple: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
}>();

const pickerOpen = ref(false);
// id → Media, so we can render thumbnails for already-selected items.
const cache = ref<Map<string, Media>>(new Map());
const missing = ref<Set<string>>(new Set());

// Normalize the stored value to an ordered list of ids regardless of shape.
const ids = computed<string[]>(() => {
  const v = props.modelValue;
  if (props.multiple) {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
  return typeof v === 'string' && v ? [v] : [];
});

async function hydrate(): Promise<void> {
  const need = ids.value.filter(
    (id) => !cache.value.has(id) && !missing.value.has(id),
  );
  await Promise.all(
    need.map(async (id) => {
      try {
        const { data } = await mediaApi.get(id);
        cache.value.set(id, data);
        cache.value = new Map(cache.value);
      } catch {
        // Referenced media was deleted — remember so we don't refetch.
        missing.value.add(id);
      }
    }),
  );
}

watch(ids, hydrate);
onMounted(hydrate);

function onSelect(chosen: Media[]): void {
  for (const m of chosen) cache.value.set(m.id, m);
  cache.value = new Map(cache.value);
  if (props.multiple) {
    const merged = [...ids.value];
    for (const m of chosen) if (!merged.includes(m.id)) merged.push(m.id);
    emit('update:modelValue', merged);
  } else {
    emit('update:modelValue', chosen[0]?.id ?? '');
  }
  pickerOpen.value = false;
}

function removeAt(id: string): void {
  if (props.multiple) {
    emit('update:modelValue', ids.value.filter((x) => x !== id));
  } else {
    emit('update:modelValue', '');
  }
}

function isImage(m: Media): boolean {
  return m.mimeType.startsWith('image/');
}
function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : 'FILE';
}
</script>

<template>
  <div class="media-field">
    <ul v-if="ids.length > 0" class="selected">
      <li v-for="id in ids" :key="id" class="item">
        <template v-if="cache.get(id)">
          <div class="thumb">
            <img
              v-if="isImage(cache.get(id)!)"
              :src="cache.get(id)!.url"
              :alt="cache.get(id)!.altText ?? cache.get(id)!.originalFilename"
            />
            <span v-else class="ext">{{ fileExt(cache.get(id)!.originalFilename) }}</span>
          </div>
          <span class="name">{{ cache.get(id)!.originalFilename }}</span>
        </template>
        <span v-else class="name muted">{{ missing.has(id) ? 'Missing media' : 'Loading…' }}</span>
        <button type="button" class="remove" aria-label="Remove" title="Remove" @click="removeAt(id)"><Icon name="x" :size="12" /></button>
      </li>
    </ul>

    <button type="button" class="btn btn--small" @click="pickerOpen = true">
      {{ multiple ? 'Add media' : ids.length ? 'Replace' : 'Choose media' }}
    </button>

    <MediaPickerModal
      v-if="pickerOpen"
      :multiple="multiple"
      @select="onSelect"
      @close="pickerOpen = false"
    />
  </div>
</template>

<style scoped>
.media-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}
.selected {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem 0.375rem 0.375rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}
.thumb {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.375rem;
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
  font-size: 0.625rem;
  color: var(--muted);
  font-weight: 600;
}
.name {
  font-size: 0.8125rem;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--muted);
}
.remove {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.8125rem;
}
.remove:hover {
  color: #dc2626;
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.8125rem;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
