<script setup lang="ts">
import type { StoryListItem } from '../../../default/app/composables/useCmsFetch';
import { formatPublishDateShort, primaryCategory } from '../../../default/app/composables/useStatusPill';
import { articleUrl, categoryUrl } from '../../../default/app/utils/urls';

// Basic theme story card — a plain white card (border + standard radius), the
// neutral counterpart to the default theme's cream Decode "scard". Same data
// contract (a StoryListItem) so it drops into the basic BlockLatestNews grid
// and any archive that reuses it.
const props = defineProps<{ story: StoryListItem }>();

const articleHref = computed(() =>
  articleUrl(props.story.slug, props.story.primaryCategorySlug),
);

// Same failed-image guard as the default card: fall back to a neutral
// placeholder rather than a broken-image icon.
const imgFailed = ref(false);
const imgEl = ref<HTMLImageElement | null>(null);
onMounted(() => {
  const el = imgEl.value;
  if (el && el.complete && el.naturalWidth === 0) imgFailed.value = true;
});
</script>

<template>
  <article class="card">
    <NuxtLink :to="articleHref" class="card-img-link">
      <img
        v-if="story.heroImageUrl && !imgFailed"
        ref="imgEl"
        loading="lazy"
        decoding="async"
        :src="story.heroImageUrl"
        :alt="story.title"
        class="card-img"
        @error="imgFailed = true"
      />
      <span v-else class="card-img card-img-placeholder" />
    </NuxtLink>
    <div class="card-body">
      <NuxtLink
        v-if="primaryCategory(story.taxonomy)"
        :to="categoryUrl(primaryCategory(story.taxonomy)!.termSlug)"
        class="card-cat"
      >{{ primaryCategory(story.taxonomy)!.termName }}</NuxtLink>
      <NuxtLink :to="articleHref" class="card-title">{{ story.title }}</NuxtLink>
      <p v-if="story.excerpt" class="card-excerpt">{{ story.excerpt }}</p>
      <div class="card-footer">
        <span v-if="story.publishedAt" class="card-date">
          {{ formatPublishDateShort(story.publishedAt) }}
        </span>
        <NuxtLink :to="articleHref" class="card-more">Read &rarr;</NuxtLink>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
  transition: box-shadow var(--transition);
}
.card:hover {
  box-shadow: var(--shadow);
}
.card-img-link {
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
}
.card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.card-img-placeholder {
  background: #f3f4f6;
}
.card-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.card-cat {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  text-decoration: none;
}
.card-cat:hover {
  color: var(--accent);
}
.card-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.35;
  text-decoration: none;
}
.card-title:hover {
  color: var(--accent);
}
.card-excerpt {
  font-size: 14px;
  color: var(--muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-footer {
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.card-date {
  font-size: 12px;
  color: var(--muted);
}
.card-more {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
}
</style>
