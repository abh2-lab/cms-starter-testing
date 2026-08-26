<script setup lang="ts">
// Contained page layout — a centered, readable content column inside the
// standard site chrome. Best for long text pages. No auto-heading (the page's
// content supplies its own headings); the `title` prop is accepted for a
// uniform interface but not rendered.
defineProps<{ title?: string | null }>();
</script>

<template>
  <div class="page-layout page-layout--contained">
    <div class="page-layout__inner">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.page-layout--contained {
  padding: 3rem 1.25rem 4rem;
}
.page-layout__inner {
  max-width: 768px;
  margin: 0 auto;
}
</style>
