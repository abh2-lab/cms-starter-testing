<script setup lang="ts">
import ScardCard from '~/components/ScardCard.vue';
import type { StoryListItem } from '~/composables/useCmsFetch';

// Field block: the current post as a story card. Wraps the shared ScardCard —
// the SAME component the archive shells append raw load-more items with — so
// composed page-1 cards and appended page-2+ cards are pixel-identical by
// construction. The loader (packages/blocks/src/blocks/post-card.ts) projects
// the box into the StoryListItem shape, primaryCategorySlug included.
const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();

const story = computed<StoryListItem | null>(() => {
  const d = props.data;
  if (!d || typeof d['title'] !== 'string' || typeof d['slug'] !== 'string') {
    return null;
  }
  return d as unknown as StoryListItem;
});
</script>

<template>
  <ScardCard v-if="story" :story="story" />
</template>
