<script setup lang="ts">
// Field block: renders the current post's hero/featured image. The URL is
// already an absolute S3 URL (resolved by the API). Style-unaware.
interface Data {
  url: string | null;
  alt: string | null;
}

defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();
</script>

<template>
  <figure v-if="data && data.url" class="block-featured-image">
    <img :src="data.url" :alt="data.alt ?? ''" loading="lazy" />
  </figure>
</template>

<style scoped>
.block-featured-image {
  margin: 0;
}
.block-featured-image img {
  display: block;
  width: 100%;
  height: auto;
}
</style>
