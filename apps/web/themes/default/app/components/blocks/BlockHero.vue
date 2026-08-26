<script setup lang="ts">
import HeroStoryCard from '~/components/HeroStoryCard.vue';
import type { StoryDetail } from '~/composables/useCmsFetch';

// Hero block — wraps the existing HeroStoryCard with the per-page block
// contract (fields + options + data). The API-side loader resolves the
// story by slug; we just render the result or a degraded placeholder.

interface Fields {
  badge?: string;
}
interface BlockOptions {
  content_type?: string;
  slug?: string;
}
interface Data {
  story: StoryDetail | null;
}

defineProps<{
  fields: Fields;
  options: BlockOptions;
  data: Data | null;
}>();
</script>

<template>
  <section class="block-hero container">
    <HeroStoryCard
      v-if="data && data.story"
      :story="(data.story as never)"
      :badge="fields.badge ?? null"
    />
    <div v-else class="empty">
      <p>
        <strong>Hero block:</strong>
        no story selected. Edit this page and set a content_type + slug.
      </p>
    </div>
  </section>
</template>

<style scoped>
.block-hero {
  padding: 24px 20px;
}
.empty {
  border: 1px dashed var(--border);
  background: var(--surface);
  border-radius: var(--radius);
  padding: 16px;
  color: var(--muted);
  font-size: 14px;
}
</style>
