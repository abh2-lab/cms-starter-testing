<script setup lang="ts">
import { useRoute } from 'vue-router';
import BlocksEditor from '@/components/editor/BlocksEditor.vue';

// Thin wrapper for /pages/:id/build → the unified editor in PAGE mode. The
// :key forces a fresh mount when the page id changes (the editor composables
// capture their id at setup), so editing page A then page B reloads cleanly.
const route = useRoute();
</script>

<template>
  <BlocksEditor :key="String(route.params['id'])" mode="page" />
</template>
