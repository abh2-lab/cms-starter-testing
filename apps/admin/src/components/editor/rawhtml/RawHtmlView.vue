<script setup lang="ts">
import { computed } from 'vue';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3';
import Icon from '@/components/Icon.vue';

// eslint-disable-next-line vue/prop-name-casing
const props = defineProps<NodeViewProps>();

const html = computed(() => {
  // node.attrs values are typed `any`; read through `unknown` to narrow safely.
  const v: unknown = props.node.attrs['html'];
  return typeof v === 'string' ? v : '';
});

function onInput(e: Event): void {
  props.updateAttributes({ html: (e.target as HTMLTextAreaElement).value });
}
</script>

<template>
  <NodeViewWrapper
    class="rawhtml-block"
    :class="{ selected }"
    data-testid="ni-rawhtml-block"
  >
    <div class="rh-head" contenteditable="false">
      <span class="rh-label"><Icon name="code" :size="13" /> Raw HTML</span>
      <span class="rh-note">Sanitised before it reaches readers</span>
      <button
        type="button"
        class="rh-btn danger"
        @click="props.deleteNode()"
      >
        Remove
      </button>
    </div>
    <textarea
      class="rh-code"
      spellcheck="false"
      placeholder="<div>…</div>"
      data-testid="ni-rawhtml-input"
      :value="html"
      contenteditable="false"
      @input="onInput"
    />
  </NodeViewWrapper>
</template>

<style scoped>
.rawhtml-block {
  margin: 24px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
}
.rawhtml-block.selected {
  border-color: var(--accent);
  box-shadow: var(--ring);
}
.rh-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-soft);
}
.rh-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}
.rh-note {
  font-size: 11px;
  color: var(--text-tertiary);
}
.rh-btn {
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
.rh-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.rh-code {
  display: block;
  width: 100%;
  min-height: 90px;
  border: none;
  outline: none;
  resize: vertical;
  padding: 12px;
  background: var(--surface-2);
  color: var(--fg);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  line-height: 1.6;
}
</style>
