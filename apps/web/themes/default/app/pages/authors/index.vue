<script setup lang="ts">
import { useSystemView } from '~/composables/useSystemView';

// /authors is now an override-backed system template (theme engine v2 Phase 4):
// this page composes the `authors` role and renders its block tree. The
// author-grid block carries the hero + filter + card grid and fetches the
// authors itself, so the page is a thin shell an admin can restructure.
const { data: view } = await useSystemView('authors');
const blocks = computed(() => view.value?.blocks ?? []);

// Keep the browser-tab title in sync with the (editable) hero title.
const heroTitle = computed<string>(() => {
  const grid = view.value?.blocks?.find((b) => b.key === 'author-grid');
  const t = grid?.fields?.['hero_title'];
  return typeof t === 'string' && t.length > 0
    ? t
    : 'The People Behind PING';
});

useHead(() => ({
  title: heroTitle.value,
  meta: [
    {
      name: 'description',
      content:
        'Meet the PING Network team.',
    },
  ],
}));
</script>

<template>
  <BlockTree :blocks="blocks" />
</template>
