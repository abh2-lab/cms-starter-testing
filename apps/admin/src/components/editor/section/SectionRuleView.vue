<script setup lang="ts">
import { computed } from 'vue';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3';

// eslint-disable-next-line vue/prop-name-casing
const props = defineProps<NodeViewProps>();

// node.attrs values are typed `any`; read through `unknown` to narrow safely.
function attrStr(key: string): string {
  const v: unknown = props.node.attrs[key];
  return typeof v === 'string' ? v : '';
}
const label = computed(() => attrStr('label'));
const anchorId = computed(() => attrStr('anchorId'));

function onLabel(e: Event): void {
  props.updateAttributes({ label: (e.target as HTMLInputElement).value });
}
function onAnchor(e: Event): void {
  props.updateAttributes({
    anchorId: (e.target as HTMLInputElement).value || null,
  });
}
</script>

<template>
  <NodeViewWrapper
    class="section-block"
    :class="{ selected }"
    contenteditable="false"
    data-testid="ni-section-block"
  >
    <div class="sb-rule">
      <input
        class="sb-label"
        type="text"
        placeholder="SECTION LABEL"
        :value="label"
        data-testid="ni-section-label"
        @input="onLabel"
      />
      <span class="sb-line" />
    </div>
    <div class="sb-controls">
      <label class="sb-anchor">
        <span># anchor</span>
        <input
          class="sb-anchor-input"
          type="text"
          placeholder="optional-id"
          :value="anchorId"
          @input="onAnchor"
        />
      </label>
      <button type="button" class="sb-btn danger" @click="props.deleteNode()">
        Remove
      </button>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.section-block {
  margin: 28px 0;
  padding: 6px;
  border: 1px dashed transparent;
  border-radius: var(--radius-sm);
}
.section-block.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.sb-rule {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sb-label {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  outline: none;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--danger, #d34135);
  font-family: inherit;
  width: 16ch;
}
.sb-label::placeholder {
  color: var(--text-tertiary);
}
.sb-line {
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}
.sb-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}
.sb-anchor {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.sb-anchor-input {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: var(--surface);
  color: var(--fg);
  width: 14ch;
}
.sb-btn {
  margin-left: auto;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: 3px 8px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
  font-family: inherit;
}
.sb-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
