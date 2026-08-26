<script setup lang="ts">
import type { StoryAuthor } from '~/composables/useCmsFetch';
import { useSearchOverlay } from '~/composables/useSearchOverlay';
import { formatPublishDate, primaryCategory } from '~/composables/useStatusPill';
import { authorsLabel } from '~/utils/byline';
import { articleUrl, categoryUrl } from '~/utils/urls';

// BlockSearchOverlay — the Decode "What are you looking for?" search modal,
// ported from the design mock (index.html / styles.css). Rendered once via the
// header part so it is global; the header search button toggles it through
// useSearchOverlay(). Submitting (or pressing Enter) routes to the existing
// /search results page; category pills link to category archives; the spotlight
// links to one hand-picked article whose data load() resolves server-side
// (mirroring featured-article). The mock CSS is reproduced verbatim with the
// brand palette hardcoded (theme tokens here are the neutral harness colors).

interface SpotlightStory {
  slug: string;
  title: string;
  heroImageUrl?: string | null;
  publishedAt: string | null;
  authors?: StoryAuthor[] | null;
  taxonomy: { termSlug: string; termName: string; taxonomySlug: string }[];
  primaryCategorySlug?: string | null;
}
interface CategoryChip {
  label: string;
  value: string;
}
interface Fields {
  heading?: string;
  placeholder?: string;
  button_label?: string;
  categories_label?: string;
  spotlight_label?: string;
  categories?: CategoryChip[];
}
interface BlockOptions {
  spotlight_content_type?: string;
  spotlight_slug?: string;
}
interface Data {
  spotlight: SpotlightStory | null;
  categories: CategoryChip[];
}

const props = defineProps<{
  fields: Fields;
  options: BlockOptions;
  data: Data | null;
}>();

const { isOpen, close } = useSearchOverlay();
const router = useRouter();

const q = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);

const heading = computed(() => props.fields.heading ?? 'What are you looking for?');
const placeholder = computed(
  () => props.fields.placeholder ?? 'Search stories, topics, authors…',
);
const buttonLabel = computed(() => props.fields.button_label ?? 'Search');
const categoriesLabel = computed(
  () => props.fields.categories_label ?? 'Popular Categories',
);
const spotlightLabel = computed(() => props.fields.spotlight_label ?? 'Spotlight');

// No hardcoded fallback: the chips show only real categories this site provides
// (props.data.categories). An empty list just hides the "Popular Categories"
// row — far better than shipping links to categories that don't exist here,
// which is what produced the /young-minds, /labour, /voices … 404s.
const displayCategories = computed<CategoryChip[]>(() => {
  const list = props.data?.categories;
  return Array.isArray(list) ? list : [];
});
function hrefFor(value: string): string {
  return value.startsWith('/') ? value : categoryUrl(value);
}

const spotlight = computed<SpotlightStory | null>(() => props.data?.spotlight ?? null);
const spotlightHref = computed(() =>
  spotlight.value
    ? articleUrl(spotlight.value.slug, spotlight.value.primaryCategorySlug ?? null)
    : '/',
);
const spotlightCategory = computed(() =>
  spotlight.value ? (primaryCategory(spotlight.value.taxonomy)?.termName ?? null) : null,
);
const spotlightMeta = computed(() => {
  const s = spotlight.value;
  if (!s) return '';
  const parts: string[] = [];
  if (s.authors && s.authors.length > 0) parts.push(authorsLabel(s.authors));
  const date = formatPublishDate(s.publishedAt);
  if (date) parts.push(date);
  return parts.join(' · ');
});

function submit(): void {
  const term = q.value.trim();
  close();
  void router.push({ path: '/search', query: term ? { q: term } : {} });
}

// Modal behavior: Esc closes, Tab is trapped within the modal, focus moves to
// the input on open and returns to the trigger on close, and body scroll is
// locked while open. All DOM access is client-only and guarded.
let lastFocused: HTMLElement | null = null;

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key !== 'Tab' || !modalRef.value) return;
  const focusables = modalRef.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

watch(isOpen, (open) => {
  if (!import.meta.client) return;
  if (open) {
    lastFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeydown);
    void nextTick(() => {
      inputRef.value?.focus();
    });
  } else {
    document.body.style.overflow = '';
    window.removeEventListener('keydown', onKeydown);
    q.value = '';
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
  }
});

onBeforeUnmount(() => {
  if (!import.meta.client) return;
  document.body.style.overflow = '';
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <div
        class="search-overlay"
        :class="{ open: isOpen }"
        role="dialog"
        aria-modal="true"
        :aria-label="heading"
        @click.self="close"
      >
        <div ref="modalRef" class="modal-content">
          <button
            type="button"
            class="search-close-btn"
            aria-label="Close search"
            @click="close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <h2 class="search-heading">{{ heading }}</h2>

          <form class="search-input-row" @submit.prevent="submit">
            <input
              ref="inputRef"
              v-model="q"
              type="search"
              class="search-input-field"
              :placeholder="placeholder"
              aria-label="Search"
            />
            <button type="submit" class="search-submit-btn">{{ buttonLabel }}</button>
          </form>

          <div v-if="displayCategories.length > 0" class="search-categories-section">
            <div class="search-section-label">{{ categoriesLabel }}</div>
            <div class="search-chips">
              <NuxtLink
                v-for="c in displayCategories"
                :key="c.value"
                :to="hrefFor(c.value)"
                class="search-chip"
                @click="close"
              >{{ c.label }}</NuxtLink>
            </div>
          </div>

          <div v-if="spotlight" class="search-spotlight-section">
            <div class="search-section-label">{{ spotlightLabel }}</div>
            <NuxtLink :to="spotlightHref" class="search-spotlight-card" @click="close">
              <div class="search-spotlight-text">
                <div v-if="spotlightCategory" class="search-spotlight-cat">
                  {{ spotlightCategory }}
                </div>
                <div class="search-spotlight-title">{{ spotlight.title }}</div>
                <div v-if="spotlightMeta" class="search-spotlight-meta">
                  {{ spotlightMeta }}
                </div>
              </div>
              <div class="search-spotlight-thumb">
                <img
                  v-if="spotlight.heroImageUrl"
                  :src="spotlight.heroImageUrl"
                  :alt="spotlight.title"
                  class="search-spotlight-thumb-img"
                />
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>

<style scoped>
.search-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 2000;
  background-color: rgba(0, 0, 0, 0.55);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}
.search-overlay.open {
  display: flex;
}

.modal-content {
  background-color: #faf9f2;
  border: 1px solid #e5e4da;
  max-width: 640px;
  width: 95%;
  border-radius: 20px;
  animation: searchModalFadeIn 0.25s ease-out;
  padding: var(--space-7);
  position: relative;
  max-height: 92vh;
  overflow-y: auto;
}
@keyframes searchModalFadeIn {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.search-close-btn {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.45);
  border: none;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.search-close-btn:hover {
  background: rgba(0, 0, 0, 0.12);
  color: #121212;
}
.search-close-btn svg {
  width: 18px;
  height: 18px;
}

.search-heading {
  font-size: var(--fs-h3);
  font-weight: var(--fw-bold);
  color: #121212;
  margin: 0 0 var(--space-5);
  line-height: var(--lh-tight);
  padding-right: var(--space-7);
}

.search-input-row {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
}
.search-input-field {
  flex: 1;
  background: #fff;
  border: 1.5px solid #e5e4da;
  border-radius: 50px;
  padding: var(--space-3) var(--space-5);
  color: #121212;
  font-family: inherit;
  font-size: var(--fs-body);
  outline: none;
  transition: border-color 0.2s;
  min-width: 0;
}
.search-input-field:focus {
  border-color: #d34135;
}
.search-input-field::placeholder {
  color: rgba(0, 0, 0, 0.3);
}
.search-submit-btn {
  background: #d34135;
  color: #fff;
  border: none;
  border-radius: 50px;
  padding: var(--space-3) var(--space-5);
  font-weight: var(--fw-bold);
  font-size: var(--fs-lead);
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
  flex-shrink: 0;
  font-family: inherit;
}
.search-submit-btn:hover {
  background: #b2342a;
}

.search-section-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: rgba(0, 0, 0, 0.35);
  margin-bottom: var(--space-3);
}
.search-categories-section {
  margin-bottom: var(--space-5);
}
.search-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.search-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid #e5e4da;
  border-radius: 50px;
  padding: var(--space-2) var(--space-4);
  color: rgba(0, 0, 0, 0.6);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  text-decoration: none;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}
.search-chip:hover {
  background: rgba(211, 65, 53, 0.08);
  border-color: rgba(211, 65, 53, 0.3);
  color: #d34135;
}

.search-spotlight-section {
  border-top: 1px solid #e5e4da;
  padding-top: var(--space-5);
}
.search-spotlight-card {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 12px;
  padding: var(--space-4);
  text-decoration: none;
  transition: background 0.2s;
}
.search-spotlight-card:hover {
  background: rgba(0, 0, 0, 0.06);
}
.search-spotlight-text {
  flex: 1;
  min-width: 0;
}
.search-spotlight-cat {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.25em;
  color: #d34135;
  margin-bottom: var(--space-2);
}
.search-spotlight-title {
  font-size: var(--fs-h4);
  font-weight: var(--fw-bold);
  color: #121212;
  line-height: var(--lh-snug);
  margin-bottom: var(--space-2);
}
.search-spotlight-meta {
  font-size: var(--fs-sm);
  color: rgba(0, 0, 0, 0.4);
}
.search-spotlight-thumb {
  width: 88px;
  height: 64px;
  border-radius: 8px;
  flex-shrink: 0;
  overflow: hidden;
  background-color: #e5e4da;
}
.search-spotlight-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (max-width: 768px) {
  .modal-content {
    padding: var(--space-5) var(--space-4);
    border-radius: 16px;
  }
  .search-input-row {
    flex-direction: column;
  }
  .search-submit-btn {
    border-radius: 50px;
    width: 100%;
  }
  .search-spotlight-thumb {
    width: 72px;
    height: 54px;
  }
}
</style>
