<script setup lang="ts">
import { useRoute } from 'vue-router';
import BlocksEditor from '@/components/editor/BlocksEditor.vue';

// Thin wrapper for /structure/:key → the unified editor in TEMPLATE/PART mode.
// The :key forces a fresh mount when the template/part key changes, so editing
// one entry then another reloads cleanly.
const route = useRoute();
</script>

<template>
  <BlocksEditor :key="String(route.params['key'])" mode="theme" />
</template>
