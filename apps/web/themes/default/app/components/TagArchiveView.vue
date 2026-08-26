<script setup lang="ts">
import {
  cmsFetch,
  type ArchiveViewPayload,
  type StoryArchive,
  type StoryListItem,
} from '~/composables/useCmsFetch';
import { splitBlocksByRegion } from '~/composables/useBlockRegions';
import { useThemePreviewToken } from '~/composables/useThemePreviewToken';
import BlockTree from '~/components/BlockTree.vue';
import ScardCard from '~/components/ScardCard.vue';
import { tagUrl } from '~/utils/urls';

// Tag archive — lists every published article tagged with the URL slug.
// Styling follows the Decode mockup's tag-digital-rights.html: dark
// tag-hero-section with a red kicker + cream title prefixed by a red
// "#", then a 3-col scard-grid below.
//
// Theme engine v1.5: the hero and the grid's cards now come from the
// composed `archive-tag` template (/api/public/views/archive/tags/<slug>),
// rendered through BlockTree — the hero region above the articles section,
// the main region (query-loop → post-card) inside the grid. The shell keeps
// page-state chrome: the grid element itself (the query-loop renders
// display:contents so raw Load More appends land in the same grid), the
// empty state, and the related-tags chips (derived client-side from the
// loaded items — composed page-1 cards + appended pages).

// Driven by a `slug` prop so the root resolver (pages/[slug]/index.vue) can
// pass the resolved tag slug after /api/public/resolve returns kind='tag'.
const props = defineProps<{
  slug: string;
}>();

const slug = computed(() => props.slug);

const contentType = 'article';

// Theme-preview token (structure editor iframe) — the composed archive
// template resolves DRAFT overrides when present.
const themePreview = useThemePreviewToken();

const { data: view } = await useAsyncData(
  () => `view:archive:tags:${slug.value}:${themePreview.value ?? 'live'}`,
  () =>
    cmsFetch<ArchiveViewPayload>(
      `/api/public/views/archive/tags/${encodeURIComponent(slug.value)}`,
      themePreview.value ? { theme_preview: themePreview.value } : undefined,
    ),
  { watch: [slug, themePreview] },
);

const regions = computed(() => splitBlocksByRegion(view.value?.blocks));
const heroBlocks = computed(() => regions.value['hero'] ?? []);
const mainBlocks = computed(() => regions.value['main'] ?? []);

// Pagination state seeded from the composed page-1 payload; "Load more"
// appends raw archive items (reset whenever the slug / view changes).
const appended = ref<StoryListItem[]>([]);
const page = ref(1);
const totalPages = ref(1);
const pageSize = ref(12);
const total = ref(0);
const loadingMore = ref(false);
watch(
  view,
  (v) => {
    appended.value = [];
    page.value = v?.pagination.page ?? 1;
    totalPages.value = v?.pagination.totalPages ?? 1;
    pageSize.value = v?.pagination.pageSize ?? 12;
    total.value = v?.pagination.total ?? 0;
  },
  { immediate: true },
);
const hasMore = computed(() => page.value < totalPages.value);
async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const next = page.value + 1;
    const res = await cmsFetch<StoryArchive>(
      `/api/public/archive/${contentType}`,
      { pageSize: pageSize.value, page: next, tag: slug.value },
    );
    if (res) {
      appended.value = [...appended.value, ...res.items];
      page.value = res.pagination.page;
      totalPages.value = res.pagination.totalPages;
    }
  } finally {
    loadingMore.value = false;
  }
}

// Page-1 stories as the composed post-card data inside the main region's
// query-loop — the related-tags derivation needs their taxonomy, and the
// composed tree is where page 1 now lives.
const composedStories = computed<StoryListItem[]>(() => {
  const out: StoryListItem[] = [];
  for (const b of mainBlocks.value) {
    if (b.key !== 'query-loop') continue;
    for (const child of b.children ?? []) {
      if (child.key === 'post-card' && child.data) {
        out.push(child.data as unknown as StoryListItem);
      }
    }
  }
  return out;
});
const allItems = computed<StoryListItem[]>(() => [
  ...composedStories.value,
  ...appended.value,
]);

// "Related tags" — derived from the OTHER tags on the loaded articles. No
// dedicated endpoint: collect every non-current `tags` term off the items,
// dedupe by slug, cap the list. Grows as more pages load.
const relatedTags = computed<{ termSlug: string; termName: string }[]>(() => {
  const seen = new Set<string>();
  const out: { termSlug: string; termName: string }[] = [];
  for (const it of allItems.value) {
    for (const t of it.taxonomy ?? []) {
      if (t.taxonomySlug !== 'tags' || t.termSlug === slug.value) continue;
      if (seen.has(t.termSlug)) continue;
      seen.add(t.termSlug);
      out.push({ termSlug: t.termSlug, termName: t.termName });
      if (out.length >= 12) return out;
    }
  }
  return out;
});

// Hash-tag title for the document head — same whitespace-strip the hero
// block applies ("Digital Rights" → #DigitalRights).
const hashTagTitle = computed(() =>
  (view.value?.archive.title ?? '').replace(/\s+/g, ''),
);

useHead(() => ({
  title: `#${hashTagTitle.value}`,
  meta: [
    {
      name: 'description',
      content: view.value?.archive.description ?? '',
    },
  ],
}));
</script>

<template>
  <section class="tag-page">
    <BlockTree :blocks="heroBlocks" />

    <section class="tag-articles-section">
      <div class="container-custom">
        <div v-if="total === 0" class="tag-empty">
          <p>No published stories with this tag yet.</p>
        </div>
        <div v-else class="tag-articles-grid">
          <BlockTree :blocks="mainBlocks" />
          <ScardCard
            v-for="story in appended"
            :key="story.id"
            :story="story"
          />
        </div>

        <div v-if="hasMore" class="archive-loadmore">
          <button
            type="button"
            class="btn-load-more"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? 'Loading…' : 'Load more stories' }}
          </button>
        </div>

        <div v-if="relatedTags.length > 0" class="tag-related-tags">
          <span class="tag-related-label">Related tags</span>
          <NuxtLink
            v-for="t in relatedTags"
            :key="t.termSlug"
            :to="tagUrl(t.termSlug)"
            class="tag-related-link"
          >#{{ t.termName }}</NuxtLink>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.tag-page {
  background: transparent;
}
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}

/* Hero styling lives in the archive-hero block component since v1.5
   re-blocking (BlockArchiveHero.vue). */

.tag-articles-section {
  padding: 48px 0 60px;
}
.tag-articles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 28px;
}

.tag-empty {
  text-align: center;
  color: #6b7280;
  padding: 32px 0;
}

/* ─── Load more ────────────────────────────────────────────── */
.archive-loadmore {
  margin-top: 40px;
  text-align: center;
}
.btn-load-more {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 2px solid #000;
  color: #000;
  padding: 14px 40px;
  border-radius: 999px;
  font-family: 'Figtree', sans-serif;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-load-more:hover:not(:disabled) {
  background: #000;
  color: #fff;
}
.btn-load-more:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ─── Related tags ─────────────────────────────────────────── */
.tag-related-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 48px;
  padding-top: 32px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}
.tag-related-label {
  width: 100%;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: rgba(0, 0, 0, 0.4);
  margin-bottom: 4px;
}
.tag-related-link {
  font-size: 13px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.6);
  background: #faf9f2;
  border: 1px solid #e5e4da;
  padding: 8px 18px;
  border-radius: 50px;
  text-decoration: none;
  transition: all 0.2s;
}
.tag-related-link:hover {
  color: #d34135;
  border-color: #d34135;
}

@media (max-width: 768px) {
  .tag-articles-grid {
    grid-template-columns: 1fr;
  }
}
</style>
