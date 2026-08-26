<script setup lang="ts">
import type { StoryListItem } from '~/composables/useCmsFetch';
import {
  formatPublishDate,
  primaryCategory,
} from '~/composables/useStatusPill';
import { authorsLabel } from '~/utils/byline';
import { articleUrl } from '~/utils/urls';

const props = defineProps<{
  story: StoryListItem;
  badge?: string | null;
  readTimeMin?: number;
}>();

const category = computed(() => primaryCategory(props.story.taxonomy));
const dateLabel = computed(() => formatPublishDate(props.story.publishedAt));
const articleHref = computed(() =>
  articleUrl(props.story.slug, props.story.primaryCategorySlug),
);
</script>

<template>
  <article class="hero-story">
    <NuxtLink :to="articleHref" class="hero-story-img-wrap">
      <img
        v-if="story.heroImageUrl"
        :src="story.heroImageUrl"
        :alt="story.title"
        class="hero-story-img"
      />
      <div v-else class="hero-story-img placeholder"></div>
    </NuxtLink>
    <div class="hero-story-body">
      <span v-if="badge" class="badge-special">{{ badge }}</span>
      <div v-else-if="category" class="card-cat">{{ category.termName }}</div>
      <h2>
        <NuxtLink :to="articleHref">{{ story.title }}</NuxtLink>
      </h2>
      <div class="meta">
        <span v-if="story.authors">By {{ authorsLabel(story.authors) }}</span>
        <span v-if="dateLabel">
          <template v-if="story.authors"> · </template>{{ dateLabel }}
        </span>
        <span v-if="readTimeMin">
          <template v-if="story.authors || dateLabel"> · </template>{{ readTimeMin }} min read
        </span>
      </div>
      <p v-if="story.excerpt">{{ story.excerpt }}</p>
      <NuxtLink :to="articleHref" class="btn-outline">
        Read more
      </NuxtLink>
    </div>
  </article>
</template>

<style scoped>
.hero-story {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 24px;
  align-items: center;
  min-width: 0;
}
.hero-story > * {
  min-width: 0;
}
.hero-story-img-wrap {
  display: block;
  border-radius: var(--radius-lg);
  overflow: hidden;
  text-decoration: none;
}
.hero-story-img {
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: cover;
  display: block;
  background: #f3f4f6;
}
.hero-story-img.placeholder {
  background: #f3f4f6;
}
.card-cat {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-bottom: 8px;
}
.hero-story-body h2 {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 8px;
}
.hero-story-body h2 a {
  color: inherit;
  text-decoration: none;
}
.hero-story-body h2 a:hover {
  color: var(--accent);
}
.meta {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 10px;
}
.hero-story-body p {
  font-size: 15px;
  color: var(--muted);
  line-height: 1.6;
  margin-bottom: 12px;
}

@media (max-width: 768px) {
  .hero-story {
    grid-template-columns: 1fr;
  }
}
</style>
