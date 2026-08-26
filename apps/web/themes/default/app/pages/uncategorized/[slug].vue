<script setup lang="ts">
import ArticleView from '~/components/ArticleView.vue';

// Defensive fallback for articles without a primary category. The
// publish gate from commit 2.1 of this wave makes this URL unreachable
// from the editorial flow on Decode's Article CPT (category required
// at publish time), but the route exists so preview tokens on draft
// articles + any future CPT that opts out of the gate still resolve.
const route = useRoute();
const articleSlug = computed(() => {
  const raw = route.params['slug'];
  return typeof raw === 'string' ? raw : '';
});
</script>

<template>
  <ArticleView :slug="articleSlug" />
</template>
