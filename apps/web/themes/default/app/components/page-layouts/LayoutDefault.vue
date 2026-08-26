<script setup lang="ts">
// Default page layout — renders the body AS-IS, full width, inside the standard
// site chrome (header/footer). No container constraint and no auto-heading, so
// the page's own content controls its width and headings. This is the safe
// default: it preserves exactly how static pages rendered before layouts were
// applied, so existing pages don't shift. The `title` prop is accepted for a
// uniform layout interface but not rendered.
defineProps<{ title?: string | null }>();
</script>

<template>
  <div class="page-layout page-layout--default">
    <slot />
  </div>
</template>

<style scoped>
.page-layout--default {
  width: 100%;
}
</style>
