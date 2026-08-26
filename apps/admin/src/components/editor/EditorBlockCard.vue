<script setup lang="ts">
import { computed, inject } from 'vue';
import type { BlockMeta, PageBlockInstance } from '@/api/pages';
import BlockFieldsForm from '@/components/BlockFieldsForm.vue';
import Icon from '@/components/Icon.vue';
import { BLOCK_TREE_KEY, type BlockTreeApi, type TreePath } from './useBlockTree';
import { EDITOR_UI_KEY, type EditorUi } from './editor-ui';

// One block in the structure popup. Thin header = block NAME (larger font) +
// an X remove; reorder is via ↑/↓ buttons (sibling-scoped — the reliable
// shipped path). Clicking the header expands the block's settings INLINE here
// (Copy = meta.fields, Bindings = meta.options). The structural `region`
// option is never shown — it controls which page column the block lands in and
// must not be hand-edited.

const props = defineProps<{
  block: PageBlockInstance;
  meta: BlockMeta | undefined;
  path: TreePath;
  total: number;
}>();

const treeInj = inject(BLOCK_TREE_KEY);
if (!treeInj) throw new Error('EditorBlockCard must render inside the block tree');
const tree: BlockTreeApi = treeInj;
const uiInj = inject(EDITOR_UI_KEY);
if (!uiInj) throw new Error('EditorBlockCard must render inside the editor UI');
const ui: EditorUi = uiInj;

const index = computed(() => props.path[props.path.length - 1] ?? 0);
const expanded = computed(() => ui.expandedId.value === props.block.id);
const focused = computed(() => ui.focusedId.value === props.block.id);

function toggle(): void {
  ui.focusedId.value = props.block.id;
  ui.expandedId.value = expanded.value ? null : props.block.id;
}

// Never surface the structural placement option in the settings UI.
const editableOptions = computed(() =>
  (props.meta?.options ?? []).filter((f) => f.key !== 'region'),
);
const copyFields = computed(() => props.meta?.fields ?? []);

// Content type of the nearest ancestor box — drives the custom-field picker so
// it lists THIS box's content-type fields. Null at the page root / no box.
const ancestorContentTypeSlug = computed(() =>
  tree.resolveAncestorContentType(props.path),
);
</script>

<template>
  <div :class="['ebc', { 'ebc--focused': focused, 'ebc--open': expanded }]">
    <div class="ebc-head" @click="toggle">
      <span class="ebc-name">{{ meta?.label ?? block.block_key }}</span>
      <code class="ebc-key">{{ block.block_key }}</code>
      <span v-if="!meta" class="ebc-missing" title="Not in the manifest">?</span>

      <div class="ebc-actions" @click.stop>
        <button
          type="button"
          class="ebc-iconbtn"
          title="Move up"
          :disabled="index === 0"
          @click="tree.move(path, -1)"
        >
          <Icon name="chevron-up" :size="13" />
        </button>
        <button
          type="button"
          class="ebc-iconbtn"
          title="Move down"
          :disabled="index === total - 1"
          @click="tree.move(path, 1)"
        >
          <Icon name="chevron-down" :size="13" />
        </button>
        <button
          type="button"
          class="ebc-iconbtn ebc-remove"
          title="Remove block"
          @click="tree.remove(path)"
        >
          <Icon name="x" :size="13" />
        </button>
      </div>
    </div>

    <div v-if="expanded" class="ebc-body">
      <template v-if="meta">
        <section v-if="copyFields.length > 0" class="ebc-sec">
          <div class="ebc-sec-label">Copy</div>
          <BlockFieldsForm
            :schema="copyFields"
            :values="block.fields"
            :ancestor-content-type-slug="ancestorContentTypeSlug"
            @update="tree.updateFields(path, $event)"
          />
        </section>
        <section v-if="editableOptions.length > 0" class="ebc-sec">
          <div class="ebc-sec-label">Data bindings</div>
          <BlockFieldsForm
            :schema="editableOptions"
            :values="block.options"
            :ancestor-content-type-slug="ancestorContentTypeSlug"
            @update="tree.updateOptions(path, $event)"
          />
        </section>
        <p
          v-if="copyFields.length === 0 && editableOptions.length === 0"
          class="ebc-none"
        >
          This block has no editable settings.
        </p>
      </template>
      <p v-else class="ebc-warn">
        <code>{{ block.block_key }}</code> isn’t in the manifest. Remove it or
        wait for the build that ships its definition.
      </p>
    </div>
  </div>
</template>

<style scoped>
.ebc {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  margin-bottom: 6px;
  overflow: hidden;
}
.ebc--focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--info-soft);
}
.ebc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  cursor: pointer;
  user-select: none;
  background: var(--surface-2);
}
.ebc-head:hover {
  background: var(--page-bg, #f5f6f8);
}
.ebc-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary, var(--fg));
  flex-shrink: 0;
}
.ebc-key {
  font-size: 10.5px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ebc-missing {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ebc-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.ebc-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: none;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
}
.ebc-iconbtn:hover:not(:disabled) {
  background: var(--bg, #f3f4f6);
  color: var(--fg, #111);
}
.ebc-iconbtn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.ebc-remove:hover {
  color: var(--danger);
  background: var(--danger-soft);
}
.ebc-body {
  padding: 12px 12px 14px;
  border-top: 1px solid var(--border-soft);
}
.ebc-sec + .ebc-sec {
  margin-top: 12px;
}
.ebc-sec-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 8px;
}
.ebc-none,
.ebc-warn {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.ebc-warn {
  color: var(--warning);
  background: var(--warning-soft);
  border: 1px solid var(--warning);
  border-radius: var(--radius);
  padding: 8px 10px;
}
.ebc-warn code {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
</style>
