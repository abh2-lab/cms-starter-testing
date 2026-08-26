<script setup lang="ts">
// Chrome-less layout — NO site header or footer. Used for pages whose layout is
// `chromeless` (Blank). The root resolver ([slug]/index.vue) selects it per page
// via definePageMeta({ layout: false }) + a reactive <NuxtLayout :name>, and
// falls back to 'default' for every other page.
</script>

<template>
  <div class="blank-shell">
    <slot />
  </div>
</template>

<style scoped>
.blank-shell {
  min-height: 100vh;
}
</style>
