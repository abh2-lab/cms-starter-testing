<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3';
import { mediaApi, type Media } from '@/api/media';
import MediaPickerModal from '@/components/MediaPickerModal.vue';
import Icon from '@/components/Icon.vue';

// NodeViewProps.HTMLAttributes is PascalCase by Tiptap's design — see EmbedView.
// eslint-disable-next-line vue/prop-name-casing
const props = defineProps<NodeViewProps>();

const WIDTHS = ['full', 'half', 'constrained'] as const;
const FLOATS = [
  { value: null, label: 'None' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
] as const;

// node.attrs values are typed `any`; read them through `unknown` so the
// string narrowing stays type-safe (no unsafe-assignment / stray assertions).
function attrStr(key: string): string {
  const v: unknown = props.node.attrs[key];
  return typeof v === 'string' ? v : '';
}

const mediaId = computed(() => attrStr('mediaId') || null);
const width = computed(() => attrStr('width') || 'full');
const float = computed<string | null>(() => attrStr('float') || null);
const caption = computed(() => attrStr('caption'));
const credit = computed(() => attrStr('credit'));

// Resolve the mediaId to a Media row so we can show the thumbnail in-editor
// (the stored doc carries only the id — the public API resolves the URL).
const media = ref<Media | null>(null);
const loadError = ref(false);
async function loadMedia(): Promise<void> {
  const id = mediaId.value;
  if (!id) {
    media.value = null;
    return;
  }
  try {
    const { data } = await mediaApi.get(id);
    media.value = data;
    loadError.value = false;
  } catch {
    media.value = null;
    loadError.value = true;
  }
}
watch(mediaId, loadMedia, { immediate: true });

const pickerOpen = ref(false);
function onReplace(chosen: Media[]): void {
  const m = chosen[0];
  if (m) {
    media.value = m;
    props.updateAttributes({ mediaId: m.id });
  }
  pickerOpen.value = false;
}

function onCaption(e: Event): void {
  props.updateAttributes({
    caption: (e.target as HTMLInputElement).value || null,
  });
}
function onCredit(e: Event): void {
  props.updateAttributes({
    credit: (e.target as HTMLInputElement).value || null,
  });
}
</script>

<template>
  <NodeViewWrapper
    class="image-block"
    :class="{ selected }"
    data-testid="ni-image-block"
  >
    <div class="image-stage" :data-width="width" :data-float="float ?? ''">
      <img
        v-if="media"
        :src="media.url"
        :alt="media.altText ?? media.originalFilename"
        class="image-thumb"
      />
      <div v-else class="image-empty">
        <Icon name="image" :size="22" />
        <span>{{ loadError ? 'Image unavailable' : 'Loading…' }}</span>
      </div>
    </div>

    <div class="image-controls" contenteditable="false">
      <div class="ic-row">
        <input
          class="ic-input"
          type="text"
          placeholder="Caption (optional)"
          :value="caption"
          @input="onCaption"
        />
        <input
          class="ic-input ic-credit"
          type="text"
          placeholder="Credit"
          :value="credit"
          @input="onCredit"
        />
      </div>
      <div class="ic-row ic-buttons">
        <div class="ic-group" role="group" aria-label="Width">
          <button
            v-for="w in WIDTHS"
            :key="w"
            type="button"
            class="ic-btn"
            :class="{ active: width === w }"
            @click="props.updateAttributes({ width: w })"
          >
            {{ w }}
          </button>
        </div>
        <div class="ic-group" role="group" aria-label="Float">
          <button
            v-for="f in FLOATS"
            :key="f.label"
            type="button"
            class="ic-btn"
            :class="{ active: float === f.value }"
            @click="props.updateAttributes({ float: f.value })"
          >
            {{ f.label }}
          </button>
        </div>
        <div class="ic-spacer" />
        <button
          type="button"
          class="ic-btn"
          data-testid="ni-image-replace"
          @click="pickerOpen = true"
        >
          {{ media ? 'Replace' : 'Choose image' }}
        </button>
        <button
          type="button"
          class="ic-btn danger"
          @click="props.deleteNode()"
        >
          Remove
        </button>
      </div>
    </div>

    <MediaPickerModal
      v-if="pickerOpen"
      :multiple="false"
      @select="onReplace"
      @close="pickerOpen = false"
    />
  </NodeViewWrapper>
</template>

<style scoped>
.image-block {
  margin: 24px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg);
}
.image-block.selected {
  border-color: var(--accent);
  box-shadow: var(--ring);
}
.image-stage {
  display: flex;
  justify-content: center;
  background: var(--surface-2);
  padding: 12px;
}
.image-stage[data-width='half'] .image-thumb {
  max-width: 50%;
}
.image-stage[data-width='constrained'] .image-thumb {
  max-width: 360px;
}
.image-thumb {
  max-width: 100%;
  max-height: 360px;
  border-radius: 4px;
  display: block;
}
.image-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px;
  color: var(--text-tertiary);
  font-size: 13px;
}
.image-controls {
  padding: 10px 12px;
  border-top: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ic-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.ic-buttons {
  flex-wrap: wrap;
}
.ic-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  font-size: 12.5px;
  font-family: inherit;
  background: var(--surface);
  color: var(--fg);
}
.ic-credit {
  max-width: 160px;
}
.ic-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.ic-group .ic-btn {
  border: none;
  border-radius: 0;
}
.ic-group .ic-btn + .ic-btn {
  border-left: 1px solid var(--border);
}
.ic-spacer {
  flex: 1;
}
.ic-btn {
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
.ic-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.ic-btn.active {
  background: var(--accent-soft);
  color: var(--fg);
}
.ic-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
