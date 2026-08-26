<script setup lang="ts">
import {
  cmsFetch,
  type StoryArchive,
  type StoryListItem,
  type TaxonomyTerm,
} from '~/composables/useCmsFetch';
import { formatPublishDate } from '~/composables/useStatusPill';
import { authorsLabel } from '~/utils/byline';
import { articleUrl } from '~/utils/urls';

// `/news` is an alias for the stories archive. The CMS-driven nav can ship a
// menu item pointing at /news (a common legacy URL for news sites) without
// the public Vue Router warning about an unregistered route, and any inbound
// link to /news resolves to the same archive page.
definePageMeta({ alias: ['/news'] });

const route = useRoute();
const router = useRouter();

const contentType = 'article';
const categoryTaxonomy = 'categories';

const activeCategory = computed<string>(() => {
  const raw = route.query['category'];
  return typeof raw === 'string' ? raw : '';
});
const page = computed<number>(() => {
  const raw = route.query['page'];
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
});

const pageSize = 12;

const { data: archive, pending } = await useAsyncData(
  () => `archive:${activeCategory.value || '_all'}:${String(page.value)}`,
  () =>
    cmsFetch<StoryArchive>(`/api/public/archive/${contentType}`, {
      pageSize,
      page: page.value,
      ...(activeCategory.value ? { category: activeCategory.value } : {}),
    }),
  { watch: [activeCategory, page] },
);

const items = computed<StoryListItem[]>(() => archive.value?.items ?? []);
const total = computed<number>(() => archive.value?.pagination.total ?? 0);
const totalPages = computed<number>(
  () => archive.value?.pagination.totalPages ?? 0,
);

// First archive page (unfiltered) used to derive filter pills from live
// taxonomy terms. Avoids a hardcoded category list and stays generic.
const { data: firstPageArchive } = await useAsyncData(
  'archive:filter-source',
  () =>
    cmsFetch<StoryArchive>(`/api/public/archive/${contentType}`, {
      pageSize: 50,
    }),
);

interface Filter {
  slug: string;
  label: string;
}

const filters = computed<Filter[]>(() => {
  const acc = new Map<string, string>();
  for (const it of firstPageArchive.value?.items ?? []) {
    for (const t of it.taxonomy ?? []) {
      if (t.taxonomySlug === categoryTaxonomy && !acc.has(t.termSlug)) {
        acc.set(t.termSlug, t.termName);
      }
    }
  }
  const list: Filter[] = [{ slug: '', label: 'All' }];
  for (const [slug, label] of acc) list.push({ slug, label });
  return list;
});

const headerLabel = computed<string>(() => {
  if (!activeCategory.value) return 'All articles';
  const match = filters.value.find((f) => f.slug === activeCategory.value);
  return match?.label ?? activeCategory.value;
});

const setCategory = (slug: string): void => {
  void router.push({
    path: route.path,
    query: slug ? { category: slug } : {},
  });
};

const goToPage = (n: number): void => {
  void router.push({
    path: route.path,
    query: {
      ...(activeCategory.value ? { category: activeCategory.value } : {}),
      ...(n > 1 ? { page: String(n) } : {}),
    },
  });
};

const primaryCategory = (taxonomy: TaxonomyTerm[]): TaxonomyTerm | null =>
  taxonomy.find((t) => t.taxonomySlug === categoryTaxonomy) ?? null;

useHead({
  title: () => `${headerLabel.value} — Archive`,
});
</script>

<template>
  <section class="container archive-header">
    <h1>{{ headerLabel }}</h1>
    <p>Browse the full archive. Filter by category below.</p>
  </section>

  <div class="container">
    <div class="filter-bar" role="tablist" aria-label="Categories">
      <button
        v-for="c in filters"
        :key="c.slug || 'all'"
        type="button"
        class="filter-btn"
        :class="{ active: activeCategory === c.slug }"
        :aria-pressed="activeCategory === c.slug"
        @click="setCategory(c.slug)"
      >
        {{ c.label }}
      </button>
    </div>
  </div>

  <section class="container listing">
    <div v-if="pending && items.length === 0" class="empty-state">
      <p>Loading…</p>
    </div>
    <div v-else-if="items.length === 0" class="empty-state">
      <p>No articles match this filter yet.</p>
    </div>
    <ul v-else class="stories-list">
      <li v-for="s in items" :key="s.id" class="story-row">
        <NuxtLink :to="articleUrl(s.slug, s.primaryCategorySlug)" class="story-link">
          <h2>{{ s.title }}</h2>
          <p v-if="s.excerpt" class="story-excerpt">{{ s.excerpt }}</p>
          <div class="story-meta">
            <span v-if="primaryCategory(s.taxonomy)">
              {{ primaryCategory(s.taxonomy)?.termName }}
            </span>
            <span v-if="s.authors">By {{ authorsLabel(s.authors) }}</span>
            <span v-if="s.publishedAt">
              {{ formatPublishDate(s.publishedAt) }}
            </span>
            <span v-if="s.featured" class="status-pill featured">Featured</span>
          </div>
        </NuxtLink>
      </li>
    </ul>

    <div v-if="totalPages > 1" class="pagination">
      <button
        type="button"
        class="btn-outline"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      >
        Previous
      </button>
      <span class="page-status">
        Page {{ page }} of {{ totalPages }} · {{ total }} item{{
          total === 1 ? '' : 's'
        }}
      </span>
      <button
        type="button"
        class="btn-outline"
        :disabled="page >= totalPages"
        @click="goToPage(page + 1)"
      >
        Next
      </button>
    </div>
  </section>
</template>

<style scoped>
.archive-header {
  padding: 40px 20px 16px;
}
.archive-header h1 {
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 6px;
}
.archive-header p {
  color: var(--muted);
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 20px 24px;
  border-bottom: 1px solid var(--border);
}
.filter-btn {
  padding: 6px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  color: var(--text);
}
.filter-btn:hover {
  border-color: var(--text);
}
.filter-btn.active {
  background: var(--text);
  color: var(--accent-fg);
  border-color: var(--text);
}

.listing {
  padding: 24px 20px 60px;
}
.stories-list {
  list-style: none;
  display: flex;
  flex-direction: column;
}
.story-row {
  border-bottom: 1px solid var(--border);
}
.story-row:last-child {
  border-bottom: none;
}
.story-link {
  display: block;
  padding: 16px 0;
  text-decoration: none;
  color: inherit;
}
.story-link h2 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}
.story-link:hover h2 {
  color: var(--accent);
}
.story-excerpt {
  color: var(--muted);
  font-size: 14px;
  margin-bottom: 6px;
}
.story-meta {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--muted);
  flex-wrap: wrap;
}

.empty-state {
  padding: 40px 0;
  color: var(--muted);
}

.pagination {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 32px;
  flex-wrap: wrap;
}
.page-status {
  font-size: 13px;
  color: var(--muted);
}
</style>
