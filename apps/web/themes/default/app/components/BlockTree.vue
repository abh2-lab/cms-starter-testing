<script setup lang="ts">
import type { ComposedBlock } from '~/composables/useBlockRegistry';

// Renders an ordered list of composed blocks. Recurses with BlockNode, which in
// turn renders this component for any block's children — together they walk the
// nested block-tree the API composer produced. Used by pages, the single
// article body column, and archives (one renderer, written once).
defineProps<{ blocks: ComposedBlock[] }>();
</script>

<template>
  <BlockNode v-for="b in blocks" :key="b.id" :block="b" />
</template>
