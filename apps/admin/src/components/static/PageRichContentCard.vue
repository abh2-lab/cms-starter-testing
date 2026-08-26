<script setup lang="ts">
import { useBodyEditor } from '@/composables/useBodyEditor';
import { useMediaPicker } from '@/composables/useMediaPicker';
import EditorToolbar from '@/components/editor/EditorToolbar.vue';
import EditorContentBody from '@/components/editor/EditorContentBody.vue';
import MediaPickerModal from '@/components/MediaPickerModal.vue';

// Page Content — Normal (rich text) mode. Uses the SAME body-editor stack as the
// article/post editor: the full formatting toolbar (headings, lists, quotes,
// tables, links, images, alignment, slash menu) sharing one Tiptap instance via
// useBodyEditor, plus the shared media picker for image/gallery inserts. The
// body is a Tiptap JSON doc, rendered on the public site through the same
// renderTiptap pipeline the article body uses — so what you write here renders
// identically to a post.
const body = defineModel<object | null>('body', { required: true });

const {
  open: pickerOpen,
  multiple: pickerMultiple,
  pick: pickMedia,
  resolve: pickerResolve,
  cancel: pickerCancel,
} = useMediaPicker();

const { editor } = useBodyEditor({
  getValue: () => body.value,
  onChange: (value) => {
    body.value = value;
  },
  // Page editor doesn't surface a word-count bar; the editor still needs a sink.
  onStats: () => {},
  placeholder: 'Write your page content… press / for blocks',
  pickMedia,
});
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="card-title">Page Content</span>
      <span class="mode-label">Rich text</span>
    </div>

    <template v-if="editor">
      <EditorToolbar :editor="editor" :pick-media="pickMedia" />
      <div class="page-editor-body">
        <EditorContentBody :editor="editor" />
      </div>
    </template>

    <!-- Shared media picker for the toolbar/slash image + gallery inserts. -->
    <MediaPickerModal
      v-if="pickerOpen"
      :multiple="pickerMultiple"
      @select="pickerResolve"
      @close="pickerCancel"
    />
  </div>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.card-header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.mode-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.page-editor-body {
  padding: 18px 20px 24px;
}
</style>
