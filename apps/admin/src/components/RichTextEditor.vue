<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { StarterKit } from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

interface Props {
  modelValue: object | string | null | undefined;
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Write something…',
});

const emit = defineEmits<{
  'update:modelValue': [value: object];
}>();

const editor = useEditor({
  content: props.modelValue ?? '',
  extensions: [
    StarterKit.configure({
      link: { openOnClick: false },
    }),
    Placeholder.configure({ placeholder: props.placeholder }),
  ],
  onUpdate({ editor }) {
    emit('update:modelValue', editor.getJSON());
  },
});

// Sync EXTERNAL value changes into the editor (e.g., when the parent
// loads a fresh row). Skip when the change came from our own onUpdate
// to avoid an infinite loop.
watch(
  () => props.modelValue,
  (value) => {
    const ed = editor.value;
    if (!ed) return;
    const current = ed.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      ed.commands.setContent(value ?? '', { emitUpdate: false });
    }
  },
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<template>
  <div class="rich-text">
    <!-- v-if narrows away the `undefined` branch of useEditor's return type
         (Editor | undefined) before passing to EditorContent, which insists
         on a non-undefined editor under exactOptionalPropertyTypes. -->
    <EditorContent v-if="editor" :editor="editor" />
  </div>
</template>

<style scoped>
.rich-text :deep(.ProseMirror) {
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  min-height: 8rem;
  outline: none;
  font-size: 0.9375rem;
  line-height: 1.5;
}
.rich-text :deep(.ProseMirror:focus) {
  border-color: var(--accent);
}
.rich-text :deep(.ProseMirror p) {
  margin: 0.5rem 0;
}
.rich-text :deep(.ProseMirror p:first-child) {
  margin-top: 0;
}
.rich-text :deep(.ProseMirror h1),
.rich-text :deep(.ProseMirror h2),
.rich-text :deep(.ProseMirror h3) {
  margin: 1rem 0 0.5rem;
  line-height: 1.2;
}
.rich-text :deep(.ProseMirror code) {
  background: var(--border);
  padding: 0.0625rem 0.25rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.875em;
}
.rich-text :deep(.ProseMirror pre) {
  background: var(--border);
  padding: 0.75rem;
  border-radius: 0.375rem;
  overflow-x: auto;
}
.rich-text :deep(.ProseMirror a) {
  color: var(--accent);
  text-decoration: underline;
}
.rich-text :deep(.ProseMirror ul),
.rich-text :deep(.ProseMirror ol) {
  padding-left: 1.5rem;
}
.rich-text :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--muted);
  pointer-events: none;
  float: left;
  height: 0;
}
</style>
