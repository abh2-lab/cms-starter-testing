<script setup lang="ts">
import ScardCard from '~/components/ScardCard.vue';
import {
  cmsFetch,
  type SearchResults,
  type StoryListItem,
} from '~/composables/useCmsFetch';
import { primaryCategory } from '~/composables/useStatusPill';

// Search Results block — the result grid + pagination for /search (theme engine
// v2 Phase 4). Reads `q`/`page` from the URL and fetches /api/public/search
// itself (SSR + client via useAsyncData), so the block stays in sync with the
// search hero through the route. Results render as the shared Decode story card
// (ScardCard) — the same card the archive/home grids use — so search matches
// the rest of the site. `content_type`/`page_size` are editable options.
interface Fields {
  empty_prefix?: string;
}
interface Options {
  content_type?: string;
  page_size?: number;
}

const props = defineProps<{
  fields: Fields;
  options: Options;
  data: unknown;
}>();

const route = useRoute();
const router = useRouter();

const contentType = computed(() =>
  typeof props.options.content_type === 'string' &&
  props.options.content_type.length > 0
    ? props.options.content_type
    : 'article',
);
const pageSize = computed(() => {
  const n = Number(props.options.page_size);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 12;
});

const q = computed<string>(() => {
  const raw = route.query['q'];
  return typeof raw === 'string' ? raw.trim() : '';
});
const page = computed<number>(() => {
  const raw = route.query['page'];
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
});

const { data: results, pending } = await useAsyncData(
  () => `search-results:${q.value}:${String(page.value)}`,
  () => {
    if (!q.value) return Promise.resolve(null);
    return cmsFetch<SearchResults>('/api/public/search', {
      q: q.value,
      pageSize: pageSize.value,
      page: page.value,
      type: contentType.value,
    });
  },
  { watch: [q, page] },
);

// The search endpoint returns the archive item shape but omits the server-
// derived primaryCategorySlug (it ships `taxonomy` instead). Derive it here
// from the first `categories` term so ScardCard builds /<category>/<slug>
// links (else it falls back to /uncategorized/<slug>).
const cards = computed<StoryListItem[]>(() =>
  (results.value?.items ?? []).map((s) => ({
    ...s,
    primaryCategorySlug:
      s.primaryCategorySlug ?? primaryCategory(s.taxonomy)?.termSlug ?? null,
  })),
);
const total = computed(() => results.value?.pagination.total ?? 0);
const totalPages = computed(() => results.value?.pagination.totalPages ?? 0);
const emptyPrompt = computed(
  () => props.fields.empty_prefix ?? 'Type a query above to search.',
);

function goToPage(n: number): void {
  void router.push({
    path: '/search',
    query: {
      q: q.value,
      ...(n > 1 ? { page: String(n) } : {}),
    },
  });
}
</script>

<template>
  <section v-if="q" class="container-custom listing">
    <p class="result-status">
      <template v-if="pending">Searching…</template>
      <template v-else-if="total === 0">
        No results for <strong>“{{ q }}”</strong>.
      </template>
      <template v-else>
        {{ total }} result{{ total === 1 ? '' : 's' }} for
        <strong>“{{ q }}”</strong>.
      </template>
    </p>

    <div v-if="cards.length > 0" class="cards-grid">
      <ScardCard v-for="s in cards" :key="s.id" :story="s" />
    </div>

    <div v-if="totalPages > 1" class="pagination">
      <button
        type="button"
        class="page-btn"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      >
        Previous
      </button>
      <span class="page-status">Page {{ page }} of {{ totalPages }}</span>
      <button
        type="button"
        class="page-btn"
        :disabled="page >= totalPages"
        @click="goToPage(page + 1)"
      >
        Next
      </button>
    </div>
  </section>

  <section v-else class="container-custom empty-prompt">
    <p>{{ emptyPrompt }}</p>
  </section>
</template>

<style scoped>
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}
.listing {
  padding-top: 32px;
  padding-bottom: 64px;
}
.empty-prompt {
  padding-top: 40px;
  padding-bottom: 64px;
}
.result-status {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #6b7280;
  margin: 0 0 28px;
}
.result-status strong {
  color: #121212;
}
.cards-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 32px;
}
.pagination {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 40px;
  flex-wrap: wrap;
}
.page-btn {
  border: 1px solid #e5e4da;
  background: #faf9f2;
  color: #121212;
  padding: 9px 18px;
  border-radius: 50px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s, border-color 0.2s;
}
.page-btn:hover:not(:disabled) {
  border-color: #d34135;
  color: #d34135;
}
.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.page-status {
  font-size: 13px;
  color: #6b7280;
}
.empty-prompt p {
  color: #6b7280;
}

@media (max-width: 1024px) {
  .cards-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .container-custom {
    padding: 0 20px;
  }
  .cards-grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }
}
</style>
