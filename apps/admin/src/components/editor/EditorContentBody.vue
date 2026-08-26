<script setup lang="ts">
import { EditorContent, type Editor } from '@tiptap/vue-3';

defineProps<{ editor: Editor }>();
</script>

<template>
  <EditorContent :editor="editor" class="editor-content" />
</template>

<style scoped>
.editor-content :deep(.ProseMirror) {
  outline: none;
  min-height: 320px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 17px;
  line-height: 1.85;
  color: var(--fg);
}
.editor-content :deep(.ProseMirror > * + *) {
  margin-top: 1.1em;
}
.editor-content :deep(.ProseMirror h2) {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  margin-top: 1.6em;
}
.editor-content :deep(.ProseMirror h3) {
  font-size: 18px;
  font-weight: 600;
  margin-top: 1.4em;
}
.editor-content :deep(.ProseMirror blockquote) {
  border-left: 3px solid var(--accent);
  padding-left: 18px;
  color: var(--muted);
  font-style: italic;
}
.editor-content :deep(.ProseMirror a) {
  color: var(--info);
  text-decoration: underline;
}
.editor-content :deep(.ProseMirror ul),
.editor-content :deep(.ProseMirror ol) {
  padding-left: 24px;
}
.editor-content :deep(.ProseMirror code) {
  background: var(--border);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.85em;
}
.editor-content :deep(.ProseMirror pre) {
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 12px 14px;
  border-radius: var(--radius);
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.editor-content :deep(.ProseMirror hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.6em 0;
}
.editor-content :deep(.ProseMirror table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 14px;
}
.editor-content :deep(.ProseMirror td),
.editor-content :deep(.ProseMirror th) {
  border: 1px solid var(--border);
  padding: 7px 10px;
  vertical-align: top;
  position: relative;
}
.editor-content :deep(.ProseMirror th) {
  background: var(--surface-2);
  font-weight: 600;
  text-align: left;
}
.editor-content :deep(.ProseMirror .selectedCell::after) {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--accent-soft);
  pointer-events: none;
}
.editor-content :deep(.ProseMirror .column-resize-handle) {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--accent);
  cursor: col-resize;
}
.editor-content :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--text-tertiary);
  pointer-events: none;
  float: left;
  height: 0;
}
</style>
