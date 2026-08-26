<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { BlockMeta, PageBlockInstance } from '@/api/pages';
import BuilderLibrary from '@/components/builder/BuilderLibrary.vue';
import Icon from '@/components/Icon.vue';
import { BLOCK_TREE_KEY, type BlockTreeApi } from './useBlockTree';
import { EDITOR_UI_KEY, type EditorUi } from './editor-ui';

// Left rail of the unified editor — two tabs:
//   1. Library  — reuses BuilderLibrary's block grid (search + categories +
//                 click-to-add). Templates are hidden (they live in the top-bar
//                 dropdown for pages).
//   2. Blocks   — a FLAT, drag-to-reorder list of the placed root blocks (the
//                 editor's drag surface; nesting is managed in the popup).
//                 Clicking a row focuses it + opens the popup on that block.
// Both this list and the popup bind to the same tree API, so a reorder here
// reflects in the popup automatically and vice-versa.

const props = defineProps<{
  blocks: PageBlockInstance[];
  blockMetas: BlockMeta[];
}>();

const treeInj = inject(BLOCK_TREE_KEY);
if (!treeInj) throw new Error('EditorLeftPanel must render inside the block tree');
const tree: BlockTreeApi = treeInj;
const uiInj = inject(EDITOR_UI_KEY);
if (!uiInj) throw new Error('EditorLeftPanel must render inside the editor UI');
const ui: EditorUi = uiInj;

const tab = ref<'library' | 'blocks'>('library');

function labelFor(b: PageBlockInstance): string {
  return tree.metaByKey.value.get(b.block_key)?.label ?? b.block_key;
}

// ── Flat-list drag (root order only) ─────────────────────────────────────────
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function onDragStart(i: number): void {
  dragFrom.value = i;
}
function onDragOver(e: DragEvent, i: number): void {
  e.preventDefault();
  dragOver.value = i;
}
function onDrop(i: number): void {
  if (dragFrom.value !== null && dragFrom.value !== i) {
    tree.moveRoot(dragFrom.value, i);
  }
  dragFrom.value = null;
  dragOver.value = null;
}
function onDragEnd(): void {
  dragFrom.value = null;
  dragOver.value = null;
}

const blockCount = computed(() => props.blocks.length);
</script>

<template>
  <aside class="elp">
    <div class="elp-tabs">
      <button
        type="button"
        :class="['elp-tab', { 'elp-tab--active': tab === 'library' }]"
        @click="tab = 'library'"
      >Library</button>
      <button
        type="button"
        :class="['elp-tab', { 'elp-tab--active': tab === 'blocks' }]"
        @click="tab = 'blocks'"
      >Blocks <span class="elp-count">{{ blockCount }}</span></button>
    </div>

    <BuilderLibrary
      v-show="tab === 'library'"
      class="elp-library"
      :block-metas="blockMetas"
      :templates="[]"
      :templates-loading="false"
      :hide-templates="true"
      @add-block="tree.addRoot($event)"
    />

    <div v-show="tab === 'blocks'" class="elp-blocks">
      <p v-if="blocks.length === 0" class="elp-empty">
        No blocks yet — add from the Library tab.
      </p>
      <div
        v-for="(b, i) in blocks"
        :key="b.id"
        :class="[
          'elp-row',
          {
            'elp-row--focused': ui.focusedId.value === b.id,
            'elp-row--over': dragOver === i,
          },
        ]"
        draggable="true"
        @dragstart="onDragStart(i)"
        @dragover="onDragOver($event, i)"
        @drop="onDrop(i)"
        @dragend="onDragEnd"
        @click="ui.focus(b.id)"
      >
        <Icon name="more-vertical" :size="13" class="elp-grip" />
        <span class="elp-row-name">{{ labelFor(b) }}</span>
        <code class="elp-row-key">{{ b.block_key }}</code>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.elp {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border-right: 1px solid var(--border);
}
.elp-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.elp-tab {
  flex: 1;
  padding: 9px 8px;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.elp-tab--active {
  color: var(--fg, #111);
  border-bottom-color: var(--accent);
}
.elp-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--border);
  font-size: 10px;
  color: var(--muted);
}
.elp-library {
  flex: 1;
  min-height: 0;
}
.elp-blocks {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  scrollbar-width: thin;
}
.elp-empty {
  margin: 0;
  padding: 20px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
.elp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  cursor: grab;
  user-select: none;
}
.elp-row:active {
  cursor: grabbing;
}
.elp-row:hover {
  border-color: var(--accent);
}
.elp-row--focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--info-soft);
}
.elp-row--over {
  border-style: dashed;
  border-color: var(--info);
}
.elp-grip {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.elp-row-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg, #111);
  flex-shrink: 0;
}
.elp-row-key {
  font-size: 10px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
