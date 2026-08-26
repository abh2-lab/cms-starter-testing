<script setup lang="ts">
// Field block: renders the heading for the archive being browsed (category/tag).
// Reads the archive context (not a post box). Style-unaware.
interface Data {
  title: string | null;
  description: string | null;
}

defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();
</script>

<template>
  <header v-if="data && data.title" class="block-archive-title">
    <h1>{{ data.title }}</h1>
    <p v-if="data.description">{{ data.description }}</p>
  </header>
</template>
