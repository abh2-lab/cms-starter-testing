<script setup lang="ts">
import {
  cmsFetch,
  type StoryArchive,
  type StoryListItem,
} from '~/composables/useCmsFetch';
import { authorUrl } from '~/utils/urls';

// Author Grid block — the whole /authors page (theme engine v2 Phase 4): a dark
// hero, a search + beat filter bar, and the card grid. Markup + styles + the
// tiptap-bio extraction moved verbatim from authors/index.vue. The hero copy,
// search placeholder and beat list are editable fields; the author content type
// and max count are options. Fetches the archive with ?include=customFields
// itself (the block loader can't carry custom fields), so it runs the same
// single query the page did.
interface Fields {
  hero_kicker?: string;
  hero_title?: string;
  search_placeholder?: string;
  beats?: string;
}
interface Options {
  content_type?: string;
  count?: number;
}

const props = defineProps<{
  fields: Fields;
  options: Options;
  data: unknown;
}>();

const contentType = computed(() =>
  typeof props.options.content_type === 'string' &&
  props.options.content_type.length > 0
    ? props.options.content_type
    : 'author',
);
const pageSize = computed(() => {
  const n = Number(props.options.count);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 24;
});

const heroKicker = computed(() => props.fields.hero_kicker ?? 'Our Team');
const heroTitle = computed(
  () => props.fields.hero_title ?? 'The People Behind PING',
);
const searchPlaceholder = computed(
  () => props.fields.search_placeholder ?? 'Search authors by name or role...',
);

// Beat filters: a comma-separated editable list with "All" always first.
// Falls back to the site's verticals when the field is unset (the block's own
// default — the view composer doesn't fill meta-field defaults), so the filter
// bar is populated out of the box.
const beatFilters = computed<string[]>(() => {
  const raw =
    typeof props.fields.beats === 'string' && props.fields.beats.length > 0
      ? props.fields.beats
      : 'Creators, Brands, Platforms, Publishing';
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ['All', ...parsed];
});

interface AuthorCard {
  id: string;
  slug: string;
  name: string;
  photoUrl: string | null;
  role: string | null;
  bioText: string | null;
  beat: string | null;
  twitter: string | null;
  email: string | null;
}

// Walk a Tiptap doc and extract the first paragraph as plain text. The
// archive endpoint returns the rich-text bio whole; we trim to ~180 chars
// for the card preview.
function tiptapFirstParagraph(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object') return null;
  const root = doc as { content?: unknown };
  if (!Array.isArray(root.content)) return null;
  for (const node of root.content) {
    if (
      node !== null &&
      typeof node === 'object' &&
      'type' in node &&
      (node as { type: unknown }).type === 'paragraph'
    ) {
      const inner = (node as { content?: unknown }).content;
      if (!Array.isArray(inner)) continue;
      const parts: string[] = [];
      for (const child of inner) {
        if (
          child !== null &&
          typeof child === 'object' &&
          'type' in child &&
          (child as { type: unknown }).type === 'text' &&
          typeof (child as { text?: unknown }).text === 'string'
        ) {
          parts.push((child as { text: string }).text);
        }
      }
      const text = parts.join('').trim();
      if (text.length > 0) {
        return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
      }
    }
  }
  return null;
}

function nameInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .filter((c) => c.length > 0);
  return (parts.slice(0, 2).join('') || '?').toUpperCase();
}

const { data: archive } = await useAsyncData(
  () => `author-grid:${contentType.value}:${String(pageSize.value)}`,
  () =>
    cmsFetch<StoryArchive>(`/api/public/archive/${contentType.value}`, {
      pageSize: pageSize.value,
      include: 'customFields',
    }),
  { watch: [contentType, pageSize] },
);

const items = computed<StoryListItem[]>(() => archive.value?.items ?? []);

const authors = computed<AuthorCard[]>(() =>
  items.value
    .map((row): AuthorCard | null => {
      const cf = row.customFields ?? {};
      const role = typeof cf['role'] === 'string' ? cf['role'] : null;
      const bioText = tiptapFirstParagraph(cf['bio']);
      const twitter =
        typeof cf['twitter_handle'] === 'string' ? cf['twitter_handle'] : null;
      const email = typeof cf['email'] === 'string' ? cf['email'] : null;
      const beat = typeof cf['beat'] === 'string' ? cf['beat'] : null;
      const photoUrl = row.heroImageUrl;
      return {
        id: row.id,
        slug: row.slug,
        name: row.title,
        photoUrl,
        role,
        bioText,
        beat,
        twitter,
        email,
      };
    })
    .filter((c): c is AuthorCard => c !== null),
);

// Filter state — client-side only; the dataset is small (one page of
// pageSize authors per install) so filtering in memory is fine.
const searchQuery = ref('');
const activeBeat = ref<string>('All');

const filteredAuthors = computed<AuthorCard[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const beat = activeBeat.value;
  return authors.value.filter((a) => {
    if (beat !== 'All' && a.beat !== beat) return false;
    if (query.length > 0) {
      const haystack = `${a.name} ${a.role ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
});

function setBeat(b: string): void {
  activeBeat.value = b;
}
</script>

<template>
  <section class="authors-page">
    <!-- ─── Dark hero ──────────────────────────────────────────── -->
    <section class="authors-hero">
      <div class="container-custom">
        <span class="authors-hero-kicker">{{ heroKicker }}</span>
        <h1 class="authors-hero-title">{{ heroTitle }}</h1>
      </div>
    </section>

    <!-- ─── Filter bar ─────────────────────────────────────────── -->
    <section class="authors-filter-section">
      <div class="container-custom">
        <div class="authors-filter-bar">
          <input
            v-model="searchQuery"
            type="text"
            class="authors-search-input"
            :placeholder="searchPlaceholder"
            aria-label="Search authors"
          />
          <div
            class="authors-filter-tags"
            role="tablist"
            aria-label="Filter by beat"
          >
            <button
              v-for="b in beatFilters"
              :key="b"
              type="button"
              class="authors-filter-btn"
              :class="{ active: activeBeat === b }"
              :aria-pressed="activeBeat === b"
              @click="setBeat(b)"
            >
              {{ b }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Grid ───────────────────────────────────────────────── -->
    <main class="authors-main">
      <div class="container-custom">
        <div v-if="filteredAuthors.length === 0" class="authors-empty">
          <p v-if="authors.length === 0">No authors published yet.</p>
          <p v-else>No authors match the current filter.</p>
        </div>
        <div v-else class="authors-grid">
          <article
            v-for="author in filteredAuthors"
            :key="author.id"
            class="author-card"
          >
            <NuxtLink
              :to="authorUrl(author.slug)"
              class="author-card-avatar-link"
            >
              <img
                v-if="author.photoUrl"
                :src="author.photoUrl"
                :alt="author.name"
                class="author-avatar"
                loading="lazy"
                decoding="async"
              />
              <span
                v-else
                class="author-avatar author-avatar-initials"
                aria-hidden="true"
              >
                {{ nameInitials(author.name) }}
              </span>
            </NuxtLink>
            <h2 class="author-card-name">
              <NuxtLink :to="authorUrl(author.slug)">{{ author.name }}</NuxtLink>
            </h2>
            <p v-if="author.role" class="author-card-role">{{ author.role }}</p>
            <p v-if="author.bioText" class="author-card-bio">
              {{ author.bioText }}
            </p>
            <div class="author-card-social">
              <a
                v-if="author.twitter"
                :href="`https://twitter.com/${author.twitter.replace(/^@/, '')}`"
                class="author-social-link"
                target="_blank"
                rel="noopener"
                aria-label="Twitter"
              >
                <svg class="icon-xs" fill="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M18.244 2H21l-6.553 7.49L22 22h-6.828l-5.35-6.97L3.71 22H1l7.02-8.03L2 2h6.914l4.84 6.285L18.244 2zm-1.195 18h1.892L7.86 3.938H5.83L17.05 20z"
                  />
                </svg>
              </a>
              <a
                v-if="author.email"
                :href="`mailto:${author.email}`"
                class="author-social-link"
                aria-label="Email"
              >
                <svg
                  class="icon-xs"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </a>
            </div>
            <span v-if="author.beat" class="author-card-tag">{{
              author.beat
            }}</span>
          </article>
        </div>
      </div>
    </main>
  </section>
</template>

<style scoped>
.authors-page {
  background: transparent;
}
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}

/* ─── Hero ─────────────────────────────────────────────────── */
.authors-hero {
  background-color: #121212;
  color: #e5e5e5;
  padding: 60px 0 50px;
}
.authors-hero-kicker {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4em;
  color: #d34135;
  margin-bottom: 12px;
  display: block;
}
.authors-hero-title {
  font-size: clamp(36px, 5vw, 52px);
  font-weight: 700;
  line-height: 1.1;
  color: #f3f0e0;
  margin: 0;
}

/* ─── Filter bar ──────────────────────────────────────────── */
.authors-filter-section {
  background-color: #faf7f2;
  padding: 24px 0;
  border-bottom: 1px solid #e5e5e5;
}
.authors-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
.authors-search-input {
  flex: 1;
  min-width: 200px;
  padding: 10px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  background-color: #fff;
  transition: border-color 0.2s;
}
.authors-search-input:focus {
  outline: none;
  border-color: #d34135;
}
.authors-filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.authors-filter-btn {
  padding: 6px 16px;
  border: 1px solid #d1d5db;
  border-radius: 50px;
  background: #fff;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  color: #555;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  flex-shrink: 0;
}
.authors-filter-btn:hover {
  border-color: #d34135;
  color: #d34135;
}
.authors-filter-btn.active {
  background-color: #121212;
  color: #fff;
  border-color: #121212;
}

/* ─── Grid ────────────────────────────────────────────────── */
.authors-main {
  padding: 40px 0 60px;
  background: #faf7f2;
}
.authors-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 28px;
}
.authors-empty {
  text-align: center;
  color: #6b7280;
  padding: 32px 0;
}

/* ─── Author card (mock-aligned) ─────────────────────────── */
.author-card {
  background: #faf9f2;
  border-radius: 28px;
  padding: 24px;
  text-align: center;
  border: 1px solid #e5e4da;
  transition: 0.4s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}
.author-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.08);
}

.author-card-avatar-link {
  display: block;
  margin-bottom: 16px;
}
.author-avatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  border: 3px solid #e5e4da;
  background: linear-gradient(135deg, #d34135 0%, #b71c1c 100%);
  color: #fff;
}
.author-avatar-initials {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.author-card-name {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.2;
  margin: 0 0 4px 0;
}
.author-card-name a {
  color: #121212;
  text-decoration: none;
  transition: color 0.2s;
}
.author-card-name a:hover {
  color: #d34135;
}

.author-card-role {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: #d34135;
  margin: 0 0 12px 0;
}

.author-card-bio {
  font-size: 14px;
  line-height: 1.5;
  color: #666;
  margin: 0 0 16px 0;
  flex: 1;
}

.author-card-social {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-bottom: 16px;
}
.author-social-link {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #eeebe0;
  border: 1px solid #e5e4da;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  transition: all 0.3s ease;
}
.author-social-link:hover {
  background: #d34135;
  border-color: #d34135;
  color: #fff;
}
.icon-xs {
  width: 18px;
  height: 18px;
}

/* Beat pill — sits at the bottom of the card. Same red token as the role
   line above; the rounded background is the mock's "tag" treatment. */
.author-card-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #d34135;
  background: rgba(211, 65, 53, 0.08);
  padding: 4px 12px;
  border-radius: 50px;
}

/* ─── Responsive ──────────────────────────────────────────── */
@media (max-width: 768px) {
  .authors-hero {
    padding: 40px 0 32px;
  }
  .authors-grid {
    grid-template-columns: 1fr;
  }
  .authors-filter-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .authors-search-input {
    min-width: 100%;
  }
  /* Horizontal-scroll the filter buttons on mobile so all five fit. */
  .authors-filter-tags {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-bottom: 4px;
    max-width: 100%;
  }
  .authors-filter-tags::-webkit-scrollbar {
    display: none;
  }
}
</style>
