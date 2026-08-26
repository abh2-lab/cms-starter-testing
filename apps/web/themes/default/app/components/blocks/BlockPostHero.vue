<script setup lang="ts">
import { formatPublishDate } from '~/composables/useStatusPill';
import { authorsLabel } from '~/utils/byline';
import { authorUrl } from '~/utils/urls';
import type { StoryAuthor } from '~/composables/useCmsFetch';

// Field block: the article's dark full-width hero — kicker, title, dek,
// byline/meta chips, hero image stage with glow + caption/credit. Markup +
// styles moved verbatim from ArticleView.vue's hero section (theme engine
// v1.5 re-blocking). The NYT serif variant stays an ArticleView concern: it
// re-targets .article-title / .article-dek / .container-custom through
// :deep() from the page root.
interface ByAuthor {
  slug: string;
  name: string;
}
interface Data {
  title: string;
  publishedAt: string | null;
  heroImageUrl: string | null;
  kicker: string | null;
  subtitle: string | null;
  heroCaption: string | null;
  heroCredit: string | null;
  readingTime: number | null;
  bylineAuthors: ByAuthor[];
  fallbackAuthors: StoryAuthor[] | null;
}

const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Data | null;
}>();

const authors = computed<ByAuthor[]>(() => props.data?.bylineAuthors ?? []);
</script>

<template>
  <section v-if="data" class="article-hero-wrap">
    <div class="article-hero-section">
      <div class="container-custom">
        <div class="article-hero-inner">
          <span v-if="data.kicker" class="article-kicker lbl-investigation">
            {{ data.kicker }}
          </span>
          <h1 class="article-title">{{ data.title }}</h1>
          <p v-if="data.subtitle" class="article-dek">{{ data.subtitle }}</p>
          <div class="article-meta-row">
            <div v-if="authors.length > 0" class="article-meta-chip">
              <span class="article-meta-dot" aria-hidden="true"></span>
              By
              <template v-for="(a, i) in authors" :key="a.slug">
                <NuxtLink :to="authorUrl(a.slug)" class="article-meta-link">
                  {{ a.name }}
                </NuxtLink>
                <span
                  v-if="i < authors.length - 2"
                  class="article-meta-authors-sep"
                >, </span>
                <span
                  v-else-if="i === authors.length - 2"
                  class="article-meta-authors-sep"
                > &amp; </span>
              </template>
            </div>
            <div v-else-if="data.fallbackAuthors" class="article-meta-chip">
              <span class="article-meta-dot" aria-hidden="true"></span>
              By {{ authorsLabel(data.fallbackAuthors) }}
            </div>
            <div v-if="data.readingTime" class="article-meta-chip">
              <span class="article-meta-dot" aria-hidden="true"></span>
              {{ data.readingTime }} min read
            </div>
            <div v-if="data.publishedAt" class="article-meta-chip">
              <span class="article-meta-dot" aria-hidden="true"></span>
              {{ formatPublishDate(data.publishedAt) }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="data.heroImageUrl" class="article-hero-image-stage">
        <div class="article-hero-image-inner">
          <div
            class="article-hero-glow"
            :style="{ backgroundImage: `url(${data.heroImageUrl})` }"
            aria-hidden="true"
          ></div>
          <div class="article-hero-print">
            <img
              :src="data.heroImageUrl"
              :alt="data.title"
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
        <div v-if="data.heroCaption || data.heroCredit" class="container-custom">
          <p class="article-caption">
            <span v-if="data.heroCaption">{{ data.heroCaption }}</span>
            <span v-if="data.heroCaption && data.heroCredit"> &middot; </span>
            <span v-if="data.heroCredit">{{ data.heroCredit }}</span>
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}

/* ─── Hero ──────────────────────────────────────────────────────────── */
.article-hero-wrap {
  background-color: #121212;
}
.article-hero-section {
  padding: 40px 0 0 0;
  color: #e5e5e5;
}
.article-hero-inner {
  margin-bottom: 36px;
}
.article-kicker {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  display: inline-block;
  margin-bottom: 16px;
}
.lbl-investigation {
  color: #d34135 !important;
}
.article-title {
  font-size: clamp(40px, 5vw, 64px);
  font-weight: 700;
  line-height: 1.02;
  color: #f3f0e0;
  margin: 0 0 16px 0;
  letter-spacing: -0.02em;
}
.article-dek {
  font-size: 18px;
  line-height: 1.7;
  color: rgba(243, 240, 224, 0.78);
  margin: 0 0 24px 0;
  max-width: 62ch;
}
.article-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.article-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #9ca3af;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50px;
  background: none;
  font-family: inherit;
}
.article-meta-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #d34135;
  flex-shrink: 0;
}
.article-meta-link {
  color: #f3f0e0;
  text-decoration: none;
  font-weight: 600;
}
.article-meta-link:hover {
  color: #d34135;
}
.article-meta-authors-sep {
  color: #6b7280;
  font-weight: 400;
}

/* Hero image — dark stage with ambient glow. Bleeds edge-to-edge across
   the viewport (calc(50% - 50vw) negative margin trick) so the image
   reads as a full-width premium stage, not a column-constrained block.
   Matches the published Decode article mock. */
.article-hero-image-stage {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  background: #0b0b0b;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  position: relative;
  overflow: hidden;
}
.article-hero-image-inner {
  min-height: 560px;
  position: relative;
  display: grid;
  place-items: center;
  padding: 26px 16px;
}
.article-hero-glow {
  position: absolute;
  inset: -40px;
  background-size: cover;
  background-position: center;
  opacity: 0.1;
  filter: blur(38px) saturate(1.05) contrast(1.05);
  transform: scale(1.08);
  z-index: 0;
}
.article-hero-print {
  position: relative;
  z-index: 2;
  width: min(980px, 94vw);
  aspect-ratio: 1280 / 768;
  border-radius: 18px;
  overflow: hidden;
  background: #0f0f0f;
  box-shadow:
    0 40px 110px rgba(0, 0, 0, 0.55),
    0 2px 0 rgba(255, 255, 255, 0.05) inset;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.article-hero-print::before {
  content: '';
  position: absolute;
  inset: 10px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 3;
  pointer-events: none;
}
.article-hero-print img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.article-caption {
  color: rgba(255, 255, 255, 0.58);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  margin-top: 12px;
  padding-bottom: 18px;
}
</style>
