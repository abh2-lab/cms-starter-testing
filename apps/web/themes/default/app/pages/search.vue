<script setup lang="ts">
import { useSystemView } from '~/composables/useSystemView';

// /search is now an override-backed system template (theme engine v2 Phase 4):
// this page just composes the `search` role and renders its block tree. The
// search-form + search-results blocks read the URL's `q`/`page` and run the
// query themselves, so the page is a thin shell an admin can restructure.
const route = useRoute();
const { data: view } = await useSystemView('search');
const blocks = computed(() => view.value?.blocks ?? []);

const q = computed<string>(() => {
  const raw = route.query['q'];
  return typeof raw === 'string' ? raw.trim() : '';
});

useHead({
  title: () => (q.value ? `Search: ${q.value}` : 'Search'),
});
</script>

<template>
  <BlockTree :blocks="blocks" />
</template>
