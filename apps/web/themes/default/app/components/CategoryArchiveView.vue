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

// Decode category landing page (/category/<slug>). Layout follows the
// published mock (decode-allfiles-v3/category-decode-explains.html):
// a 380px sticky sidebar on the left and a 2-column grid of stories on the
// right. No top hero strip; the manifesto carries the heading weight.
//
// Theme engine v1.5: the sidebar pieces (manifesto, editor-notes panel,
// dispatch box) and the story grid's cards now come from the composed
// `archive-category` template (/api/public/views/archive/categories/<slug>),
// rendered through BlockTree into this shell. The shell keeps what is
// page-state, not content: the layout grid + sticky aside, the empty state,
// and Load More — which appends RAW /api/public/archive items as ScardCard
// (the same component the post-card block wraps) into the same grid element
// the composed cards occupy (the query-loop renders display:contents), so
// appended cards are pixel-identical to composed ones.

// Driven by a `slug` prop so the root resolver (pages/[slug]/index.vue) can
// pass the resolved category slug after /api/public/resolve returns
// kind='category'.
const props = defineProps<{
  slug: string;
}>();

const slug = computed(() => props.slug);

const contentType = 'article';

// Theme-preview token (structure editor iframe) — the composed archive
// template resolves DRAFT overrides when present.
const themePreview = useThemePreviewToken();

const { data: view } = await useAsyncData(
  () =>
    `view:archive:categories:${slug.value}:${themePreview.value ?? 'live'}`,
  () =>
    cmsFetch<ArchiveViewPayload>(
      `/api/public/views/archive/categories/${encodeURIComponent(slug.value)}`,
      themePreview.value ? { theme_preview: themePreview.value } : undefined,
    ),
  { watch: [slug, themePreview] },
);

const regions = computed(() => splitBlocksByRegion(view.value?.blocks));
const sidebarBlocks = computed(() => regions.value['sidebar'] ?? []);
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
      { pageSize: pageSize.value, page: next, category: slug.value },
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

useHead(() => ({
  title: view.value?.archive.title ?? '',
  meta: [
    {
      name: 'description',
      content: view.value?.archive.description ?? '',
    },
  ],
}));
</script>

<template>
  <section class="category-page">
    <div class="container-custom">
      <div class="category-layout">

        <!-- ─── Sidebar: composed sidebar region ───────────────── -->
        <aside class="category-sidebar">
          <BlockTree :blocks="sidebarBlocks" />
        </aside>

        <!-- ─── Article grid: composed main region + appends ───── -->
        <div>
          <div v-if="total === 0" class="category-empty">
            <p>No articles published in this category yet.</p>
          </div>
          <div v-else class="category-articles-grid">
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
        </div>

      </div>
    </div>
  </section>
</template>

<style scoped>
.category-page {
  background: transparent;
}
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}

.category-layout {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 48px;
  align-items: start;
  padding: 40px 0 60px;
}

/* ─── Sidebar ──────────────────────────────────────────────── */
/* Piece styling (manifesto, slider panel, dispatch box) lives in the
   matching block components since v1.5 re-blocking. */
.category-sidebar {
  position: sticky;
  top: var(--header-h);
}

/* ─── Articles grid ────────────────────────────────────────── */
.category-articles-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 28px;
}
.category-empty {
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

/* ─── Responsive ──────────────────────────────────────────── */
@media (max-width: 1024px) {
  .category-layout {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .category-sidebar {
    position: static;
  }
}
@media (max-width: 768px) {
  .category-articles-grid {
    grid-template-columns: 1fr;
  }
}
</style>
