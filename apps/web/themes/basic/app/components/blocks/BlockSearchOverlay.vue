<script setup lang="ts">
// Basic theme: the header uses a plain search LINK to /search (see BlockSiteNav),
// so the full-screen Decode search overlay is intentionally a no-op here. Kept
// as an override so the shared header part's `search-overlay` block renders
// nothing on the basic theme.
defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();
</script>

<template>
  <span class="basic-search-overlay-noop" aria-hidden="true" hidden />
</template>
