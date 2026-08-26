<script setup lang="ts">
// Field block: renders the current post's rich-text body. Wraps the existing
// ContentBody component (which calls renderTiptap) — the body STAYS in TipTap.
// The body JSON is delivered by the post-content loader reading the box.
interface Data {
  body: unknown;
}

defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();
</script>

<template>
  <ContentBody v-if="data && data.body" :doc="data.body" :dropcap="true" />
</template>
