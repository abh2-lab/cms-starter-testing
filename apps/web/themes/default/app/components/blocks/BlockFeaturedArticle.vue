<script setup lang="ts">
import type { StoryAuthor } from '~/composables/useCmsFetch';
import { formatPublishDate, primaryCategory } from '~/composables/useStatusPill';
import { authorsLabel } from '~/utils/byline';
import { articleUrl } from '~/utils/urls';

// Featured Article block — a single hand-picked story shown as a feature
// card. The API loader resolves the slug and returns a StoryDetail-shaped
// payload plus the few list-friendly fields (heroImageUrl, excerpt). The
// shape here is loose to accept both StoryDetail and StoryListItem.

interface FeaturedStory {
  slug: string;
  title: string;
  heroImageUrl?: string | null;
  excerpt?: string | null;
  publishedAt: string | null;
  authors?: StoryAuthor[] | null;
  taxonomy: { termSlug: string; termName: string; taxonomySlug: string }[];
  // First taxonomy term whose taxonomySlug === 'categories'. Emitted by the
  // public archive + content endpoints (commit 1.2 of the flat-URL wave)
  // so this block can build /<category>/<article> URLs from the loader
  // output without walking the taxonomy array.
  primaryCategorySlug?: string | null;
}
interface Fields {
  eyebrow?: string;
}
interface BlockOptions {
  content_type?: string;
  slug?: string;
}
interface Data {
  story: FeaturedStory | null;
}

const props = defineProps<{
  fields: Fields;
  options: BlockOptions;
  data: Data | null;
}>();

const category = computed(() =>
  props.data?.story ? primaryCategory(props.data.story.taxonomy) : null,
);
const dateLabel = computed(() =>
  props.data?.story ? formatPublishDate(props.data.story.publishedAt) : null,
);
const articleHref = computed(() =>
  props.data?.story
    ? articleUrl(
        props.data.story.slug,
        props.data.story.primaryCategorySlug ?? null,
      )
    : '/',
);
</script>

<template>
  <section class="block-featured container">
    <template v-if="data && data.story">
      <article class="card">
        <NuxtLink :to="articleHref" class="img-wrap">
          <img
            v-if="data.story.heroImageUrl"
            :src="data.story.heroImageUrl"
            :alt="data.story.title"
            class="img"
          />
          <div v-else class="img placeholder"></div>
        </NuxtLink>
        <div class="body">
          <p v-if="fields.eyebrow" class="eyebrow">{{ fields.eyebrow }}</p>
          <p v-else-if="category" class="eyebrow">{{ category.termName }}</p>
          <h2>
            <NuxtLink :to="articleHref">
              {{ data.story.title }}
            </NuxtLink>
          </h2>
          <p v-if="data.story.excerpt" class="excerpt">
            {{ data.story.excerpt }}
          </p>
          <p class="meta">
            <template v-if="data.story.authors">
              By {{ authorsLabel(data.story.authors) }}
            </template>
            <template v-if="dateLabel">
              <template v-if="data.story.authors"> · </template>{{ dateLabel }}
            </template>
          </p>
        </div>
      </article>
    </template>
    <div v-else class="empty">
      <p>
        <strong>Featured Article block:</strong>
        no story selected. Edit this page and set a content_type + slug.
      </p>
    </div>
  </section>
</template>

<style scoped>
.block-featured {
  padding: 24px 20px;
}
.card {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 20px;
  align-items: center;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 20px 0;
}
.img-wrap {
  display: block;
  border-radius: var(--radius);
  overflow: hidden;
  text-decoration: none;
}
.img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
}
.img.placeholder {
  background: #f3f4f6;
}
.eyebrow {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-bottom: 8px;
}
.body h2 {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
  margin-bottom: 10px;
}
.body h2 a {
  color: inherit;
  text-decoration: none;
}
.body h2 a:hover {
  color: var(--accent);
}
.excerpt {
  font-size: 15px;
  color: var(--muted);
  margin-bottom: 8px;
}
.meta {
  font-size: 13px;
  color: var(--muted);
}
.empty {
  border: 1px dashed var(--border);
  background: var(--surface);
  border-radius: var(--radius);
  padding: 16px;
  color: var(--muted);
  font-size: 14px;
}

@media (max-width: 768px) {
  .card {
    grid-template-columns: 1fr;
  }
}
</style>
