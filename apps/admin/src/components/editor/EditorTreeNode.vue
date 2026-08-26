<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { PageBlockInstance } from '@/api/pages';
import Icon from '@/components/Icon.vue';
import EditorBlockCard from './EditorBlockCard.vue';
import { BLOCK_TREE_KEY, type BlockTreeApi, type TreePath } from './useBlockTree';
import { EDITOR_UI_KEY } from './editor-ui';

// One node of the structure tree (recursive). Renders the block's card, then —
// for container/box blocks — an indented rail of its children plus an
// "add inside" picker. Reorder + remove + settings all live on the card; this
// wrapper only adds nesting.

const props = defineProps<{
  block: PageBlockInstance;
  path: TreePath;
  total: number;
}>();

const treeInj = inject(BLOCK_TREE_KEY);
if (!treeInj) throw new Error('EditorTreeNode must render inside the block tree');
const tree: BlockTreeApi = treeInj;
// Optional — the shared editor UI state (focus/expand) so the rail can light up
// the box's DIRECT children when this box is selected or its picker is open.
const ui = inject(EDITOR_UI_KEY);

const meta = computed(() => tree.metaByKey.value.get(props.block.block_key));
const kind = computed(() => meta.value?.kind ?? 'standalone');
const supportsChildren = computed(
  () => kind.value === 'container' || kind.value === 'box',
);
const children = computed(() => props.block.children ?? []);
const showRail = computed(
  () => supportsChildren.value || children.value.length > 0,
);

const pickerOpen = ref(false);
const pickerSearch = ref('');

// This box is the active editing scope when it's focused or its add-inside
// picker is open. We use that to highlight ONLY its direct children, so it's
// unambiguous which blocks live inside this box (vs. siblings or descendants).
const isFocused = computed(() => ui?.focusedId.value === props.block.id);
const scoped = computed(
  () => supportsChildren.value && (isFocused.value || pickerOpen.value),
);
const pickerOptions = computed(() =>
  Array.from(tree.metaByKey.value.values())
    .map((m) => ({ key: m.key, label: m.label }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);
const filteredOptions = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase();
  if (!q) return pickerOptions.value;
  return pickerOptions.value.filter(
    (o) => o.label.toLowerCase().includes(q) || o.key.toLowerCase().includes(q),
  );
});
function openPicker(): void {
  pickerSearch.value = '';
  pickerOpen.value = true;
}
function closePicker(): void {
  pickerOpen.value = false;
  pickerSearch.value = '';
}
function addBlock(key: string): void {
  tree.addChild(props.path, key);
  closePicker();
}
</script>

<template>
  <div class="etn">
    <EditorBlockCard
      :block="block"
      :meta="meta"
      :path="path"
      :total="total"
    />

    <div v-if="showRail" class="etn-rail" :class="{ 'etn-rail--scoped': scoped }">
      <div v-if="scoped" class="etn-rail-tag">
        Inside {{ meta?.label ?? block.block_key }}
      </div>
      <EditorTreeNode
        v-for="(child, idx) in children"
        :key="child.id"
        :block="child"
        :path="[...path, idx]"
        :total="children.length"
      />
      <div v-if="supportsChildren" class="etn-add">
        <div v-if="pickerOpen" class="etn-picker">
          <div class="etn-picker-head">
            <input
              v-model="pickerSearch"
              class="etn-search"
              type="text"
              placeholder="Search blocks…"
              autofocus
              @keydown.esc="closePicker"
            />
            <button type="button" class="etn-btn" @click="closePicker">
              Cancel
            </button>
          </div>
          <div class="etn-options">
            <button
              v-for="o in filteredOptions"
              :key="o.key"
              type="button"
              class="etn-option"
              @click="addBlock(o.key)"
            >
              <span class="etn-opt-label">{{ o.label }}</span>
              <code class="etn-opt-key">{{ o.key }}</code>
            </button>
            <div v-if="filteredOptions.length === 0" class="etn-no-match">
              No blocks match “{{ pickerSearch }}”.
            </div>
          </div>
        </div>
        <button v-else type="button" class="etn-addbtn" @click="openPicker">
          <Icon name="plus" :size="11" />
          Add inside {{ meta?.label ?? block.block_key }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.etn-rail {
  margin: 0 0 6px 16px;
  padding-left: 10px;
  border-left: 2px solid var(--border);
}
/* When this box is the active scope, accent its rail and ring its DIRECT
   children only. The `> .etn > .ebc` child combinator stops the highlight at
   one level — grandchildren sit under a nested `.etn-rail` and are not matched,
   so it's clear which blocks live directly inside this box. */
.etn-rail--scoped {
  border-left-color: var(--accent);
}
.etn-rail--scoped > .etn > .ebc {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--info-soft);
}
.etn-rail-tag {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
  padding: 1px 0 5px;
}
.etn-add {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0 4px;
}
.etn-addbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: none;
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
}
.etn-addbtn:hover {
  color: var(--fg, #111);
  border-color: var(--accent);
}
/* Searchable "add inside" picker — replaces the long native <select>. */
.etn-picker {
  width: 260px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.etn-picker-head {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-bottom: 1px solid var(--border);
}
.etn-search {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg, #111);
}
.etn-search:focus {
  outline: none;
  border-color: var(--accent);
}
.etn-options {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.etn-option {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: none;
  font-family: inherit;
  font-size: 12px;
  color: var(--fg, #111);
  cursor: pointer;
  text-align: left;
}
.etn-option:last-child {
  border-bottom: none;
}
.etn-option:hover {
  background: var(--bg);
}
.etn-opt-label {
  font-weight: 500;
}
.etn-opt-key {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.etn-no-match {
  padding: 10px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  text-align: center;
}
.etn-btn {
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
}
.etn-btn:not(:disabled):hover {
  color: var(--fg, #111);
  border-color: var(--accent);
}
.etn-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
