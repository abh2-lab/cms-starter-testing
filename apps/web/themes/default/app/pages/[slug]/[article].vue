<script setup lang="ts">
import PortfolioView from '~/components/PortfolioView.vue';

// Two-segment route — /<category>/<slug>. On this site every two-segment URL is
// a Portfolio entry: there is no news/article content type, so the earlier
// isolated /portfolio/<slug> route was folded into this one. The first segment
// is the entry's category (Brands / Platforms / Publishing), kept only for a
// clean, human-readable URL; the fetch keys off the second segment (the entry
// slug) alone. PortfolioView 404s cleanly if that slug is not a real portfolio
// entry, so a stray two-segment URL never renders an empty shell.
//
// Static first-segment routes (/author/<slug>, /uncategorized/<slug>,
// /preview/<...>, /authors, /stories) still win over this dynamic match, so
// they are unaffected.
const route = useRoute();
const slug = computed(() => {
  const raw = route.params['article'];
  return typeof raw === 'string' ? raw : '';
});
</script>

<template>
  <PortfolioView :slug="slug" />
</template>
