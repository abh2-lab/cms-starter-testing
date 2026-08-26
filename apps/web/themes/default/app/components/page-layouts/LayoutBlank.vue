<script setup lang="ts">
// Blank page layout — no container, no heading; the body fills the page. The
// site chrome (header/footer) is already removed by the `blank` Nuxt layout
// (see [slug]/index.vue → setPageLayout). The `title` prop is accepted for a
// uniform interface but not shown.
defineProps<{ title?: string | null }>();
</script>

<template>
  <div class="page-layout page-layout--blank">
    <slot />
  </div>
</template>

<style scoped>
.page-layout--blank {
  width: 100%;
}
</style>
