<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3';
import { mediaApi, type Media } from '@/api/media';
import MediaPickerModal from '@/components/MediaPickerModal.vue';
import Icon from '@/components/Icon.vue';

// eslint-disable-next-line vue/prop-name-casing
const props = defineProps<NodeViewProps>();

const LAYOUTS = ['grid', 'slider', 'masonry'] as const;

// node.attrs values are typed `any`; read them through `unknown` so the
// narrowing stays type-safe.
const mediaIds = computed<string[]>(() => {
  const v: unknown = props.node.attrs['mediaIds'];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
});
function attrStr(key: string): string {
  const v: unknown = props.node.attrs[key];
  return typeof v === 'string' ? v : '';
}
const layout = computed(() => attrStr('layout') || 'grid');
const caption = computed(() => attrStr('caption'));

// id → Media so we can render thumbnails for the stored ids (mirrors the
// hydration pattern in MediaField.vue).
const cache = ref<Map<string, Media>>(new Map());
async function hydrate(): Promise<void> {
  const need = mediaIds.value.filter((id) => !cache.value.has(id));
  if (need.length === 0) return;
  await Promise.all(
    need.map(async (id) => {
      try {
        const { data } = await mediaApi.get(id);
        cache.value.set(id, data);
        cache.value = new Map(cache.value);
      } catch {
        /* deleted media — leave it out of the cache */
      }
    }),
  );
}
watch(mediaIds, hydrate, { immediate: true });

const pickerOpen = ref(false);
function onAdd(chosen: Media[]): void {
  const merged = [...mediaIds.value];
  for (const m of chosen) {
    cache.value.set(m.id, m);
    if (!merged.includes(m.id)) merged.push(m.id);
  }
  cache.value = new Map(cache.value);
  props.updateAttributes({ mediaIds: merged });
  pickerOpen.value = false;
}
function removeAt(id: string): void {
  props.updateAttributes({
    mediaIds: mediaIds.value.filter((x) => x !== id),
  });
}
function onCaption(e: Event): void {
  props.updateAttributes({
    caption: (e.target as HTMLInputElement).value || null,
  });
}
</script>

<template>
  <NodeViewWrapper
    class="gallery-block"
    :class="{ selected }"
    data-testid="ni-gallery-block"
  >
    <div class="gallery-head">
      <Icon name="layers" :size="15" />
      <span class="gallery-label">Gallery · {{ mediaIds.length }} image(s)</span>
    </div>

    <div v-if="mediaIds.length" class="gallery-thumbs" :data-layout="layout">
      <div v-for="id in mediaIds" :key="id" class="gallery-thumb">
        <img
          v-if="cache.get(id)"
          :src="cache.get(id)!.url"
          :alt="cache.get(id)!.altText ?? cache.get(id)!.originalFilename"
        />
        <span v-else class="gallery-thumb-loading">…</span>
        <button
          type="button"
          class="gallery-thumb-remove"
          aria-label="Remove image"
          title="Remove image"
          @click="removeAt(id)"
        >
          <Icon name="x" :size="11" />
        </button>
      </div>
    </div>
    <div v-else class="gallery-empty">No images yet — add some below.</div>

    <div class="gallery-controls" contenteditable="false">
      <input
        class="gc-input"
        type="text"
        placeholder="Caption (optional)"
        :value="caption"
        @input="onCaption"
      />
      <div class="gc-group" role="group" aria-label="Layout">
        <button
          v-for="l in LAYOUTS"
          :key="l"
          type="button"
          class="gc-btn"
          :class="{ active: layout === l }"
          @click="props.updateAttributes({ layout: l })"
        >
          {{ l }}
        </button>
      </div>
      <div class="gc-spacer" />
      <button
        type="button"
        class="gc-btn"
        data-testid="ni-gallery-add"
        @click="pickerOpen = true"
      >
        Add images
      </button>
      <button type="button" class="gc-btn danger" @click="props.deleteNode()">
        Remove
      </button>
    </div>

    <MediaPickerModal
      v-if="pickerOpen"
      :multiple="true"
      @select="onAdd"
      @close="pickerOpen = false"
    />
  </NodeViewWrapper>
</template>

<style scoped>
.gallery-block {
  margin: 24px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  overflow: hidden;
}
.gallery-block.selected {
  border-color: var(--accent);
  box-shadow: var(--ring);
}
.gallery-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-soft);
}
.gallery-thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 6px;
  padding: 12px;
}
/* Preview the chosen layout so grid/slider/masonry are visibly different in
   the editor (mirrors how the public theme renders each). */
.gallery-thumbs[data-layout='slider'] {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
}
.gallery-thumbs[data-layout='slider'] .gallery-thumb {
  flex: 0 0 46%;
  scroll-snap-align: start;
}
.gallery-thumbs[data-layout='masonry'] {
  display: block;
  column-count: 3;
  column-gap: 6px;
}
.gallery-thumbs[data-layout='masonry'] .gallery-thumb {
  aspect-ratio: auto;
  margin-bottom: 6px;
  break-inside: avoid;
}
.gallery-thumbs[data-layout='masonry'] .gallery-thumb img {
  height: auto;
}
.gallery-thumb {
  position: relative;
  aspect-ratio: 1;
  border-radius: 4px;
  overflow: hidden;
  background: var(--surface-2);
}
.gallery-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gallery-thumb-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
}
.gallery-thumb-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.gallery-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}
.gallery-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border-soft);
}
.gc-input {
  flex: 1;
  min-width: 140px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  font-size: 12.5px;
  font-family: inherit;
  background: var(--surface);
  color: var(--fg);
}
.gc-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.gc-group .gc-btn {
  border: none;
  border-radius: 0;
}
.gc-group .gc-btn + .gc-btn {
  border-left: 1px solid var(--border);
}
.gc-spacer {
  flex: 1;
}
.gc-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: 4px 9px;
  font-size: 11.5px;
  color: var(--muted);
  cursor: pointer;
  font-family: inherit;
  text-transform: capitalize;
}
.gc-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.gc-btn.active {
  background: var(--accent-soft);
  color: var(--fg);
}
.gc-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
