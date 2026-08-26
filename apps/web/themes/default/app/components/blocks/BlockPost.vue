<script setup lang="ts">
// Box block: renders one selected post's field blocks. The API composer expanded
// the single box and composed this block's children with that post as the
// current box, so this renderer just places them via the default slot.
defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: unknown;
}>();
</script>

<template>
  <div class="block-post">
    <slot />
  </div>
</template>
