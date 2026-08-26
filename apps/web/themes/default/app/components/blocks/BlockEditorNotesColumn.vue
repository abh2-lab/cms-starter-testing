<script setup lang="ts">
import EditorNotesSlider from '~/components/EditorNotesSlider.vue';

// Standalone block: the cream sidebar panel wrapping the "From the Editor"
// slider in its column layout. Wrapper markup + styles moved verbatim from
// CategoryArchiveView.vue (theme engine v1.5 re-blocking); the slider itself
// is the shared, self-contained EditorNotesSlider. Distinct from the home
// page's editor-notes block (row layout, discovery-card wrapper, different
// background).
defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();
</script>

<template>
  <div class="category-sidebar-slider">
    <EditorNotesSlider layout="column" />
  </div>
</template>

<style scoped>
.category-sidebar-slider {
  background: #faf9f2;
  border: 1px solid #e5e4da;
  border-radius: 20px;
  padding: 20px;
  margin-bottom: 24px;
}
</style>
