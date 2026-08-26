<script setup lang="ts">
import type { StoryListItem } from '~/composables/useCmsFetch';
import { formatPublishDateShort, primaryCategory } from '~/composables/useStatusPill';
import { articleUrl, authorUrl, categoryUrl } from '~/utils/urls';

// Cream card with corner-cutout category pill, large hero image, title,
// excerpt, and a black-on-hover round arrow button. Decode mock styling
// — see C:/Users/PiNG/Downloads/decode-allfiles-v3/assets/css/styles.css
// rules under "MORE FROM DECODE — scard CARDS". Shared between the home
// "More from Decode" grid and the per-tag/per-category archive views.

const props = defineProps<{
  story: StoryListItem;
}>();

// Canonical article URL: server picks primaryCategorySlug; URL helper
// emits /<category>/<article> or /uncategorized/<article>. Computed
// once per story so the template doesn't recompute on every NuxtLink.
const articleHref = computed(() =>
  articleUrl(props.story.slug, props.story.primaryCategorySlug),
);

// Some stored articles carry a heroImageUrl that 404s (missing/expired object).
// Fall back to the cream placeholder rather than the browser's broken-image
// icon + alt text. @error catches client-side (post-hydration) failures; the
// onMounted check catches an SSR-rendered image that already failed before Vue
// attached the handler (the error event fired before hydration could listen).
// `complete && naturalWidth === 0` is failed-not-pending — and stays false for
// not-yet-loaded lazy images (complete === false), so it's lazy-safe.
const imgFailed = ref(false);
const imgEl = ref<HTMLImageElement | null>(null);
onMounted(() => {
  const el = imgEl.value;
  if (el && el.complete && el.naturalWidth === 0) imgFailed.value = true;
});
</script>

<template>
  <article class="scard-card">
    <div class="scard-img-box">
      <div v-if="primaryCategory(story.taxonomy)" class="scard-label-box">
        <NuxtLink
          :to="categoryUrl(primaryCategory(story.taxonomy)!.termSlug)"
          class="scard-label-link"
        >
          {{ primaryCategory(story.taxonomy)!.termName }}
        </NuxtLink>
      </div>
      <NuxtLink :to="articleHref" class="scard-img-link">
        <img
          v-if="story.heroImageUrl && !imgFailed"
          ref="imgEl"
          loading="lazy"
          decoding="async"
          :src="story.heroImageUrl"
          :alt="story.title"
          class="scard-img"
          @error="imgFailed = true"
        />
        <span v-else class="scard-img scard-img-placeholder" />
      </NuxtLink>
    </div>
    <NuxtLink :to="articleHref" class="scard-title">
      {{ story.title }}
    </NuxtLink>
    <p v-if="story.excerpt" class="scard-description">{{ story.excerpt }}</p>
    <div class="scard-footer">
      <span class="scard-meta">
        <template v-if="story.authors">
          By
          <template v-for="(a, i) in story.authors" :key="a.slug ?? i">
            <template v-if="i > 0 && i === story.authors.length - 1">
              &amp;
            </template>
            <template v-else-if="i > 0">, </template>
            <NuxtLink
              v-if="a.slug"
              :to="authorUrl(a.slug)"
              class="meta-link"
            >
              {{ a.displayName }}
            </NuxtLink>
            <span v-else>{{ a.displayName }}</span>
          </template>
        </template>
        <template v-if="story.publishedAt">
          <template v-if="story.authors"> &middot; </template>
          {{ formatPublishDateShort(story.publishedAt) }}
        </template>
      </span>
      <NuxtLink
        :to="articleHref"
        class="scard-btn"
        :aria-label="`Read: ${story.title}`"
      >
        &#8599;
      </NuxtLink>
    </div>
  </article>
</template>

<style scoped>
.scard-card {
  background: #faf9f2;
  border-radius: 28px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  border: none;
  transition: 0.4s ease;
  position: relative;
  height: 100%;
}
.scard-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.08);
}

.scard-img-box {
  position: relative;
  width: 100%;
  aspect-ratio: 1280 / 768;
  border-radius: 22px;
  overflow: hidden;
  margin-bottom: 20px;
}
.scard-img-link {
  display: block;
  width: 100%;
  height: 100%;
}
.scard-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.scard-img-placeholder {
  background: linear-gradient(135deg, #e5e4da, #c8c5b6);
}

.scard-label-box {
  position: absolute;
  top: -1px;
  right: -1px;
  background: #faf9f2;
  padding: 8px 14px 14px 14px;
  border-bottom-left-radius: 24px;
  z-index: 5;
}
.scard-label-box::before,
.scard-label-box::after {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  background: transparent;
}
.scard-label-box::before {
  top: 0;
  left: -20px;
  border-top-right-radius: 20px;
  box-shadow: 5px -5px 0 0 #faf9f2;
}
.scard-label-box::after {
  bottom: -20px;
  right: 0;
  border-top-right-radius: 20px;
  box-shadow: 5px -5px 0 0 #faf9f2;
}
.scard-label-link {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #121212;
  text-decoration: none;
  transition: color 0.2s;
}
.scard-label-link:hover {
  color: #d34135;
}

.scard-title {
  font-size: 20px;
  font-weight: 700;
  color: #121212;
  line-height: 1.3;
  margin: 0 12px 8px;
  display: block;
  text-decoration: none;
  transition: color 0.2s;
}
.scard-title:hover {
  color: #d34135;
}

.scard-description {
  font-size: 14px;
  color: #666;
  line-height: 1.5;
  margin: 0 12px 16px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.scard-footer {
  margin-top: auto;
  padding: 16px 12px 12px;
  border-top: 1px solid #eeebe0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.scard-meta {
  font-size: 10px;
  font-weight: 700;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-link {
  color: inherit;
  text-decoration: none;
}
.meta-link:hover {
  text-decoration: underline;
}

.scard-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #eeebe0;
  border: 1px solid #e5e4da;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  font-size: 16px;
  color: #121212;
  text-decoration: none;
  flex-shrink: 0;
}
.scard-card:hover .scard-btn {
  background: #000;
  color: #fff;
  border-color: #000;
}
</style>
