<script setup lang="ts">
import PageView from '~/components/PageView.vue';

// Homepage = the CMS dynamic page with slug `home`.
//
// It renders through the SAME PageView component as /about, /knowledge and
// /ping-shield, so all four share one renderer, one wrapper and one SEO path.
// This file used to carry a forked copy of the block-resolving loop, which had
// quietly drifted from PageView: no `data-block-id`, no support for nested
// `children` blocks, and thinner SEO meta (no robots / og:image / canonical).
// Keeping two renderers meant every future fix had to be made twice.
//
// PageView owns the fetch, the SEO head and the not-found case — so a missing
// `home` page now returns a clean 404 instead of the old onboarding hint.
</script>

<template>
  <PageView slug="home" />
</template>
