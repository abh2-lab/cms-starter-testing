<script setup lang="ts">
import type { StoryListItem } from '~/composables/useCmsFetch';
import { primaryCategory } from '~/composables/useStatusPill';
import { authorsLabel } from '~/utils/byline';
import { articleUrl } from '~/utils/urls';

const props = defineProps<{
  story: StoryListItem;
  readTimeMin?: number;
}>();

const category = computed(() => primaryCategory(props.story.taxonomy));
const articleHref = computed(() =>
  articleUrl(props.story.slug, props.story.primaryCategorySlug),
);
</script>

<template>
  <NuxtLink :to="articleHref" class="story-card">
    <div class="story-card-img" :class="{ placeholder: !story.heroImageUrl }">
      <img
        v-if="story.heroImageUrl"
        :src="story.heroImageUrl"
        :alt="story.title"
        loading="lazy"
      />
    </div>
    <div class="story-card-body">
      <div v-if="category" class="card-cat">{{ category.termName }}</div>
      <h3>{{ story.title }}</h3>
      <p v-if="story.excerpt">{{ story.excerpt }}</p>
      <div class="card-meta">
        <span v-if="story.authors">By {{ authorsLabel(story.authors) }}</span>
        <span v-else-if="readTimeMin">{{ readTimeMin }} min read</span>
        <span v-if="story.featured" class="status-pill featured">Featured</span>
      </div>
    </div>
  </NuxtLink>
</template>

<style scoped>
.story-card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
  transition: var(--transition);
  display: block;
}
.story-card:hover {
  border-color: var(--text);
}
.story-card-img {
  width: 100%;
  aspect-ratio: 3 / 2;
  background: #f3f4f6;
  overflow: hidden;
}
.story-card-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.story-card-img.placeholder {
  background: #f3f4f6;
}
.story-card-body {
  padding: 14px 16px 16px;
}
.card-cat {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-bottom: 6px;
}
.story-card-body h3 {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 6px;
}
.story-card-body p {
  font-size: 14px;
  color: var(--muted);
  line-height: 1.5;
  margin-bottom: 10px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  font-size: 13px;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
</style>
