<script setup lang="ts">
// Box block: renders the posts a query-loop resolved. The API composer already
// expanded the loop — the per-item template was composed once per post and
// flattened into this block's children — so this renderer is a pure grid
// wrapper around the default slot (the nested <BlockTree> of item subtrees).
//
// grid:'none' makes the wrapper transparent (display: contents) so the
// SURROUNDING layout owns the grid. The archive views use this: their shells
// keep the exact pre-re-blocking grid CSS, and raw load-more appends land in
// the same grid element as the composed page-1 cards.
const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: unknown;
}>();

const transparent = computed(() => props.options['grid'] === 'none');
</script>

<template>
  <div
    class="block-query-loop"
    :class="{ 'block-query-loop--contents': transparent }"
  >
    <slot />
  </div>
</template>

<style scoped>
.block-query-loop {
  display: grid;
  gap: 24px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
.block-query-loop--contents {
  display: contents;
}
</style>
