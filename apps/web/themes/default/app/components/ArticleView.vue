<script setup lang="ts">
import { provide } from 'vue';
import {
  cmsFetch,
  useCmsPart,
  type StoryDetail,
  type TaxonomyTerm,
} from '~/composables/useCmsFetch';
import { splitBlocksByRegion } from '~/composables/useBlockRegions';
import { useThemePreviewToken } from '~/composables/useThemePreviewToken';
import { resolvePostTemplateVariant } from '~/composables/usePostTemplateRegistry';
import { articleUrl, categoryUrl } from '~/utils/urls';
import { useGallerySlider } from '~/composables/useGallerySlider';
import { useEmbeds } from '~/composables/useEmbeds';
import BlockTree from '~/components/BlockTree.vue';

// Article detail view. Driven by a `slug` prop so the same render logic
// serves both flat-URL routes — pages/[slug]/[article].vue (canonical
// /<category>/<article>) and pages/uncategorized/[slug].vue (defensive
// fallback when an article has no primary category). The URL category
// segment is presentational only — the actual fetch keys off the article
// slug, and the breadcrumb anchor pulls its category from the response's
// primaryCategorySlug field, not the URL.
//
// Theme engine v1.5: the article CONTENT (hero, editorial note, TOC, body,
// tags, credits, related, author bios) renders from the composed
// `single-article` template via region buckets (see splitBlocksByRegion);
// the right rail renders from the `article-sidebar` part. This view keeps
// only the page SHELL and its interactive chrome: the 3-column grid, the
// sticky share rail, the breadcrumb + reader font-size row, the
// `.article-content` body wrapper (whose :deep() typography, reader
// font-size classes and ToC scan target must keep applying unchanged), the
// mobile share card, the preview banner, and the NYT CSS variant.
const props = defineProps<{
  slug: string;
}>();

const route = useRoute();
const slug = computed(() => props.slug);

const contentType = 'article';
const categoryTaxonomy = 'categories';

// Preview token from the admin "Preview" button. When present, the public
// content endpoint bypasses its status filter and returns the row regardless
// of publish state — we forward the token verbatim. The async key includes
// the token so a preview session and a public visit don't share a Nuxt cache
// entry.
const previewToken = computed(() => {
  const raw = route.query['preview'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

// Theme-preview token (structure editor iframe) — the composed template
// resolves DRAFT overrides when present. Forwarded on the content fetch
// here and on the part fetch inside useCmsPart.
const themePreview = useThemePreviewToken();

const { data: story } = await useAsyncData(
  () =>
    `article:${slug.value}:${previewToken.value ?? 'public'}:${themePreview.value ?? 'live'}`,
  () =>
    cmsFetch<StoryDetail>(
      `/api/public/content/${contentType}/${encodeURIComponent(slug.value)}`,
      previewToken.value || themePreview.value
        ? {
            ...(previewToken.value ? { preview: previewToken.value } : {}),
            ...(themePreview.value
              ? { theme_preview: themePreview.value }
              : {}),
          }
        : undefined,
    ),
  { watch: [slug, previewToken, themePreview] },
);

if (!story.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Article not found',
    fatal: true,
  });
}

// The right rail — composed `article-sidebar` part (newsletter CTA +
// editor-notes slider). The sticky <aside> shell below stays view chrome.
const { data: sidebarPart } = await useCmsPart('article-sidebar');
const sidebarBlocks = computed(() => sidebarPart.value?.blocks ?? []);

// Region buckets off the composed single-article template: hero renders
// full-width above the grid; lede above the body wrapper; body inside it;
// outro below. Unknown/missing regions render with the lede so a malformed
// (future) override can never lose content.
const regions = computed(() => splitBlocksByRegion(story.value?.blocks));
const heroBlocks = computed(() => regions.value['hero'] ?? []);
const ledeBlocks = computed(() => [
  ...(regions.value['lede'] ?? []),
  ...(regions.value['main'] ?? []),
]);
const bodyBlocks = computed(() => regions.value['body'] ?? []);
const outroBlocks = computed(() => regions.value['outro'] ?? []);

const cf = computed(() => story.value?.customFields ?? {});

// og:image for the document head — independent of the composed tree.
const heroUrl = computed<string | null>(() => {
  const v = cf.value['heroImageUrl'];
  return typeof v === 'string' ? v : null;
});

const variant = computed<'decode' | 'nyt'>(() => {
  // The resolved post-template drives the layout. Fall back to the legacy
  // customFields.variant (then 'decode') for older payloads / unknown keys.
  const fromTemplate = resolvePostTemplateVariant(story.value?.templateKey);
  if (fromTemplate) return fromTemplate;
  return cf.value['variant'] === 'nyt' ? 'nyt' : 'decode';
});

// Reader font-size control (the quick-actions A−/A+). 0 = default; each step
// bumps the body paragraph size via a class. bodyEl is the rendered content
// element the ToC block scans for headings — provided so BlockArticleToc
// (which renders OUTSIDE the wrapper, in the lede) can inject it.
const bodyEl = ref<HTMLElement | null>(null);
provide('article-body-el', bodyEl);

// Enhance any `slider`-layout galleries in the rendered body with arrows + a
// counter (client-only; the body is v-html so this can't be a child component).
useGallerySlider(bodyEl, slug);
// Hydrate embeds in the rendered body: load social widget scripts (tweets, etc.)
// and fill OG link-preview cards. Same client-only pattern as the gallery slider.
useEmbeds(bodyEl, slug);
const fontScale = ref(0);
const fsClass = computed(
  () => ['', 'article-fs-lg', 'article-fs-xl'][fontScale.value] ?? '',
);
function incFont(): void {
  if (fontScale.value < 2) fontScale.value += 1;
}
function decFont(): void {
  if (fontScale.value > 0) fontScale.value -= 1;
}

const primaryCategory = (taxonomy: TaxonomyTerm[]): TaxonomyTerm | null =>
  taxonomy.find((t) => t.taxonomySlug === categoryTaxonomy) ?? null;

const category = computed(() =>
  story.value ? primaryCategory(story.value.taxonomy) : null,
);

// Canonical URL. Prefer an editor-set SEO canonical; otherwise derive it from
// the request origin + the public article path (articleUrl mirrors the CPT's
// /{category}/{slug} permalink). The preview ?token query is intentionally
// dropped so the canonical always points at the clean public URL.
const requestUrl = useRequestURL();
const canonicalHref = computed<string | null>(() => {
  const explicit = story.value?.seo?.canonicalUrl;
  if (explicit && explicit.length > 0) return explicit;
  if (!story.value) return null;
  return `${requestUrl.origin}${articleUrl(story.value.slug, story.value.primaryCategorySlug)}`;
});

useHead(() => ({
  title: story.value
    ? (story.value.seo?.metaTitle ?? story.value.title)
    : 'Article',
  meta: [
    {
      name: 'description',
      content:
        story.value?.seo?.metaDescription ?? story.value?.title ?? '',
    },
    ...(heroUrl.value
      ? [{ property: 'og:image', content: heroUrl.value }]
      : []),
  ],
  link: canonicalHref.value
    ? [{ rel: 'canonical', href: canonicalHref.value }]
    : [],
}));

// Truncate a slug into a breadcrumb-friendly piece (last meaningful word).
function shortBreadcrumb(s: string): string {
  const parts = s.split('-').filter(Boolean);
  if (parts.length === 0) return s;
  // Title-case the last 1-2 words for a compact crumb.
  const last = parts.slice(-2).join(' ');
  return last.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Scroll-to-top handler for the jump-to-top share button. Inlined in the
// template (`@click="$nextTick(() => window.scrollTo(...))"`) made Vue's
// template typechecker resolve `window` against the component instance, not
// the global — which fails because the instance type doesn't carry a
// `window` member. A named function sidesteps that lookup entirely.
function scrollToTop(): void {
  if (typeof window === 'undefined') return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
  <article v-if="story" class="article-page" :class="`article-variant-${variant}`">
    <div v-if="previewToken" class="preview-banner container-custom" role="status">
      <strong>Preview</strong>
      <span>This view bypasses the publish filter and may show drafts.</span>
    </div>

    <!-- ═══ ARTICLE HERO (composed `hero` region) ═══ -->
    <BlockTree :blocks="heroBlocks" />

    <!-- ═══ ARTICLE BODY (3-column grid) ═══ -->
    <section class="article-body-section">
      <div class="container-custom">
        <div class="article-grid">
          <!-- Left: sticky share rail (large screens only) -->
          <aside class="share-rail-col d-none-mobile">
            <div class="share-rail">
              <button
                type="button"
                class="share-btn"
                aria-label="Share on X"
                title="Share on X"
              >
                <svg fill="currentColor" viewBox="0 0 24 24" class="icon-xs">
                  <path
                    d="M18.244 2H21l-6.553 7.49L22 22h-6.828l-5.35-6.97L3.71 22H1l7.02-8.03L2 2h6.914l4.84 6.285L18.244 2zm-1.195 18h1.892L7.86 3.938H5.83L17.05 20z"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="share-btn"
                aria-label="Share on WhatsApp"
                title="Share on WhatsApp"
              >
                <svg fill="currentColor" viewBox="0 0 24 24" class="icon-xs">
                  <path
                    d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.6 5.95L0 24l6.32-1.65a11.88 11.88 0 0 0 5.73 1.46h.01c6.55 0 11.9-5.34 11.9-11.9 0-3.18-1.24-6.17-3.49-8.42z"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="share-btn"
                aria-label="Copy link"
                title="Copy link"
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  class="icon-xs"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 4.93M14 11a5 5 0 01-7.07 0L5.52 9.59a5 5 0 017.07-7.07L14 4.93"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="share-btn"
                aria-label="Jump to top"
                title="Jump to top"
                @click="scrollToTop"
              >
                <svg
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  class="icon-xs"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 10l7-7 7 7M12 3v18"
                  />
                </svg>
              </button>
            </div>
          </aside>

          <!-- Center: article content -->
          <div class="article-content-col">
            <!-- Breadcrumb + quick actions -->
            <div class="article-breadcrumb-row">
              <nav class="article-breadcrumb" aria-label="Breadcrumb">
                <NuxtLink to="/">PING</NuxtLink>
                <template v-if="category">
                  <span class="article-breadcrumb-sep">/</span>
                  <NuxtLink :to="categoryUrl(category.termSlug)">
                    {{ category.termName }}
                  </NuxtLink>
                </template>
                <span class="article-breadcrumb-sep">/</span>
                <span>{{ shortBreadcrumb(story.slug) }}</span>
              </nav>
              <div class="article-quick-actions">
                <div class="article-font-btns">
                  <button
                    type="button"
                    class="article-action-pill"
                    title="Decrease font size"
                    :disabled="fontScale === 0"
                    @click="decFont"
                  >A&minus;</button>
                  <button
                    type="button"
                    class="article-action-pill"
                    title="Increase font size"
                    :disabled="fontScale === 2"
                    @click="incFont"
                  >A+</button>
                </div>
              </div>
            </div>

            <!-- Lede region (editorial note, ToC, …) — above the body -->
            <BlockTree :blocks="ledeBlocks" />

            <!-- Article body — the `body` region (the post-content block)
                 inside the SAME wrapper element as before, so the ToC scanner
                 (bodyEl), the reader font-size classes, and every
                 .article-content :deep() body rule keep applying unchanged. -->
            <div
              ref="bodyEl"
              :class="['article-content', 'article-body', fsClass]"
            >
              <BlockTree :blocks="bodyBlocks" />
            </div>

            <!-- Outro region (tags, credits, related, author bios) -->
            <BlockTree :blocks="outroBlocks" />

            <!-- Mobile share (desktop has the sticky rail) -->
            <div class="article-mobile-share">
              <div class="article-mobile-share-label">Share</div>
              <div class="article-mobile-share-btns">
                <button type="button" class="article-mobile-share-btn">X</button>
                <button type="button" class="article-mobile-share-btn">
                  WhatsApp
                </button>
                <button
                  type="button"
                  class="article-mobile-share-btn"
                  @click="scrollToTop"
                >Top</button>
              </div>
            </div>
          </div>

          <!-- Right column: composed `article-sidebar` part (desktop only). -->
          <aside class="article-sidebar article-right-col d-none-mobile">
            <BlockTree :blocks="sidebarBlocks" />
          </aside>
        </div>
      </div>
    </section>
  </article>
</template>

<style scoped>
.article-page {
  background: #fff;
  color: #121212;
}
.container-custom {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 40px;
}
.preview-banner {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  background: #fef3c7;
  color: #78350f;
  border: 1px solid #fde68a;
  border-radius: 6px;
  font-size: 13px;
  margin: 12px auto;
  max-width: 1300px;
}
.preview-banner strong {
  font-weight: 700;
}

/* Hero styling lives in the post-hero block component since v1.5 re-blocking
   (BlockPostHero.vue); this shell only places the region. */

/* ─── Body / 3-col grid ─────────────────────────────────────────────── */
.article-body-section {
  padding: 40px 0 60px;
  background: #fff;
}
.article-grid {
  display: grid;
  grid-template-columns: 84px 1fr 360px;
  gap: 32px;
  align-items: start;
}
.share-rail-col {
  position: relative;
}
.share-rail {
  position: sticky;
  top: var(--header-h);
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
.share-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid #e5e5e5;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
}
.share-btn:hover {
  background-color: #121212;
  border-color: #121212;
  color: #fff;
}
.icon-xs {
  width: 18px;
  height: 18px;
}

.article-content-col {
  min-width: 0;
}

/* Right rail shell — the cards inside are the article-sidebar part's blocks
   (BlockSidebarNewsletter / BlockEditorNotesPanel). */
.article-sidebar {
  position: sticky;
  top: 90px;
  align-self: start;
}

.article-breadcrumb-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.article-breadcrumb {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: rgba(0, 0, 0, 0.5);
}
.article-breadcrumb a {
  color: rgba(0, 0, 0, 0.5);
  text-decoration: none;
  transition: color 0.2s;
}
.article-breadcrumb a:hover {
  color: #d34135;
}
.article-breadcrumb-sep {
  margin: 0 8px;
  opacity: 0.4;
}

/* Article content */
.article-content {
  font-size: 17px;
  line-height: 1.8;
  color: #333;
}
.article-content :deep(p) {
  margin: 0 0 20px 0;
}
/* Drop cap — first letter of the MAIN body's opening paragraph only. Scoped
   to `.article-body--dropcap` (the post-content block) and to its DIRECT child
   `p` so the cap never repeats inside list items (Tiptap renders each bullet
   as `li > p`), nested structures, or custom-field blocks (which render their
   own bare `.article-body`). */
.article-content :deep(.article-body--dropcap > p:first-of-type::first-letter) {
  float: left;
  font-size: 4em;
  line-height: 0.8;
  font-weight: 700;
  color: #d34135;
  margin: 0 12px 0 0;
  padding-top: 4px;
}
.article-content :deep(h2) {
  font-size: 26px;
  font-weight: 700;
  color: #121212;
  margin: 40px 0 16px 0;
  line-height: 1.2;
}
.article-content :deep(h3) {
  font-size: 22px;
  font-weight: 700;
  color: #121212;
  margin: 36px 0 14px 0;
  line-height: 1.2;
}
.article-content :deep(blockquote) {
  margin: 34px 0;
  padding-left: 34px;
  position: relative;
  border: none;
  font-size: 20px;
  line-height: 1.75;
  font-style: italic;
  color: #121212;
}
.article-content :deep(blockquote::before) {
  content: '\201C';
  position: absolute;
  left: 0;
  top: -14px;
  font-weight: 900;
  font-size: 72px;
  line-height: 1;
  color: #d34135;
  opacity: 0.9;
}
.article-content :deep(a) {
  color: #d34135;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
.article-content :deep(a:hover) {
  text-decoration-thickness: 2px;
}
.article-content :deep(ul),
.article-content :deep(ol) {
  margin: 0 0 20px 0;
  padding-left: 24px;
}
.article-content :deep(li) {
  margin-bottom: 8px;
}

/* Underline pull-quote — the bold-statement variant from the Decode mock.
   Big serif weight, a 46px red circle holding an opening quote glyph, and
   a thick soft-red bar sitting beneath the text. Distinct from the heavy
   blockquote ::before treatment higher up — this one is in-flow editorial
   typography, not a decorative aside. */
.article-content :deep(.article-pullquote-underline) {
  position: relative;
  margin: 36px 0;
  padding: 0 0 10px 0;
  border: none;
  font-weight: 800;
  font-size: 26px;
  line-height: 1.35;
  font-style: normal;
  text-align: left;
  color: #121212;
}
.article-content :deep(.article-pullquote-underline::before) {
  content: '\201C';
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: #d34135;
  color: #fff;
  font-weight: 900;
  font-size: 30px;
  line-height: 1;
  margin-bottom: 14px;
  padding-top: 5px;
}
.article-content :deep(.article-pullquote-underline::after) {
  content: '';
  position: absolute;
  left: 0;
  right: 20%;
  bottom: -10px;
  height: 6px;
  background: rgba(211, 65, 53, 0.3);
  border-radius: 99px;
}

/* Section rule — small red kicker tag followed by a 1px hairline. Used as
   a divider in long-form pieces. The anchorId attribute on the node lands
   as the element id, so a TOC can jump to it. The line is neutral gray
   (#e5e5e5) so it reads as structural chrome, not another red accent —
   the kicker tag carries the brand colour. */
.article-content :deep(.article-section-rule) {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 40px 0 24px;
}
.article-content :deep(.article-section-tag) {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: #d34135;
  white-space: nowrap;
}
.article-content :deep(.article-section-line) {
  flex: 1 1 auto;
  height: 1px;
  background-color: #e5e5e5;
}

/* Lead paragraph / standfirst — heavier opener emitted by the LeadParagraph
   node as <p data-lead>. */
.article-content :deep([data-lead]) {
  font-size: 21px;
  line-height: 1.6;
  font-weight: 500;
  color: #1a1a1a;
  margin: 0 0 24px 0;
}

/* Inline images — width + float variants emitted by the InlineImage node once
   the API resolves its mediaId to a URL. */
.article-content :deep(.inline-image) {
  margin: 32px 0;
}
.article-content :deep(.inline-image img) {
  width: 100%;
  height: auto;
  margin: 0;
  border-radius: 14px;
  display: block;
}
.article-content :deep(.inline-image--half) {
  max-width: 60%;
}
.article-content :deep(.inline-image--constrained) {
  max-width: 420px;
  margin-left: auto;
  margin-right: auto;
}
.article-content :deep(.inline-image--float-left) {
  float: left;
  max-width: 45%;
  margin: 6px 28px 18px 0;
}
.article-content :deep(.inline-image--float-right) {
  float: right;
  max-width: 45%;
  margin: 6px 0 18px 28px;
}
.article-content :deep(.inline-image figcaption) {
  margin-top: 8px;
  font-size: 13px;
  color: #777;
  line-height: 1.5;
}

/* Galleries — grid / masonry / slider layouts emitted by the Gallery node.
   Each layout fills the full content-column width. The slider's header
   (counter + prev/next arrows) is injected client-side by useGallerySlider
   into a `.gallery-slider-header`; its chrome styles live at the end. */
.article-content :deep(.gallery) {
  margin: 32px 0;
}
.article-content :deep(.gallery .gallery-grid) {
  display: grid;
  gap: 8px;
}
.article-content :deep(.gallery .gallery-grid img) {
  width: 100%;
  margin: 0;
  border-radius: 10px;
  display: block;
}
.article-content :deep(.gallery figcaption),
.article-content :deep(.gallery .gallery-caption) {
  margin-top: 10px;
  font-size: 13px;
  color: #777;
}

/* Grid — uniform tiles that fill the column (min 220px so a handful of images
   never collapse to thumbnails). */
.article-content :deep(.gallery--grid .gallery-grid) {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.article-content :deep(.gallery--grid .gallery-grid img) {
  aspect-ratio: 4 / 3;
  object-fit: cover;
}

/* Masonry — true staggered columns (CSS multi-column) so heights vary with
   each image's aspect ratio instead of locking to a row height. */
.article-content :deep(.gallery--masonry .gallery-grid) {
  display: block;
  column-count: 3;
  column-gap: 8px;
}
.article-content :deep(.gallery--masonry .gallery-grid img) {
  height: auto;
  margin: 0 0 8px;
  break-inside: avoid;
}

/* Slider — full-width scroll-snap carousel matching the Decode mock. */
.article-content :deep(.gallery--slider) {
  background: #faf7f2;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 18px;
  padding: 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.article-content :deep(.gallery--slider .gallery-grid) {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  border-radius: 8px;
}
.article-content :deep(.gallery--slider .gallery-grid::-webkit-scrollbar) {
  display: none;
}
.article-content :deep(.gallery--slider .gallery-grid img) {
  flex: 0 0 100%;
  scroll-snap-align: start;
  aspect-ratio: 5 / 4;
  object-fit: cover;
  border-radius: 8px;
}

/* Slider chrome injected by useGallerySlider */
.article-content :deep(.gallery-slider-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.article-content :deep(.gallery-slider-count) {
  font-size: 12px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.5);
  font-variant-numeric: tabular-nums;
}
.article-content :deep(.gallery-slider-count .cur) {
  color: #121212;
}
.article-content :deep(.gallery-slider-arrows) {
  display: flex;
  gap: 6px;
}
.article-content :deep(.gallery-slider-arrow) {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1.5px solid rgba(0, 0, 0, 0.15);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #121212;
  padding: 0;
  transition:
    background 0.18s,
    border-color 0.18s,
    color 0.18s;
}
.article-content :deep(.gallery-slider-arrow:hover:not(.disabled)) {
  background: #121212;
  border-color: #121212;
  color: #fff;
}
.article-content :deep(.gallery-slider-arrow.disabled) {
  opacity: 0.3;
  cursor: default;
  pointer-events: none;
}
@media (max-width: 640px) {
  .article-content :deep(.gallery--masonry .gallery-grid) {
    column-count: 2;
  }
}

/* Quick-actions (reader font size) */
.article-quick-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.article-font-btns {
  display: flex;
  gap: 4px;
}
.article-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 50px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #faf7f2;
  font-size: 12px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.6);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
}
.article-action-pill:hover:not(:disabled) {
  color: #d34135;
  border-color: rgba(0, 0, 0, 0.3);
}
.article-action-pill:disabled {
  opacity: 0.4;
  cursor: default;
}

/* Reader font-size steps applied to the body paragraphs */
.article-content.article-fs-lg :deep(p),
.article-content.article-fs-lg :deep(li) {
  font-size: 19px;
}
.article-content.article-fs-xl :deep(p),
.article-content.article-fs-xl :deep(li) {
  font-size: 21px;
}

/* Mobile share (hidden on desktop, where the sticky rail shows) */
.article-mobile-share {
  background: #faf7f2;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 22px;
  padding: 20px 24px;
  margin-top: 32px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.article-mobile-share-label {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: rgba(0, 0, 0, 0.5);
  margin-bottom: 12px;
}
.article-mobile-share-btns {
  display: flex;
  gap: 8px;
}
.article-mobile-share-btn {
  padding: 12px 16px;
  border: none;
  border-radius: 50px;
  background: rgba(0, 0, 0, 0.03);
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  color: rgba(0, 0, 0, 0.7);
  cursor: pointer;
  transition: all 0.2s;
}
.article-mobile-share-btn:hover {
  background: #121212;
  color: #fff;
}
@media (min-width: 1025px) {
  .article-mobile-share {
    display: none;
  }
}

/* NYT (serif) variant overrides — mirror the published article-nyt mock.
   Narrower 1200px container across hero + body, Merriweather serif on the
   headline + dek + body + dropcap + quote variants, and a slightly looser
   1.9 line-height on running paragraphs to fit the larger serif rhythm.
   Section labels, kickers, meta chrome and pill chrome stay sans — those
   are UI furniture, not body type. The hero's title/dek/container live in
   the post-hero BLOCK since v1.5 re-blocking, so the rules that touch them
   go through :deep() — they must pierce the block component boundary. */
.article-variant-nyt :deep(.container-custom) {
  max-width: 1200px;
}
.article-variant-nyt :deep(.article-title) {
  font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.article-variant-nyt :deep(.article-dek) {
  font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
  font-weight: 300;
  line-height: 1.7;
  max-width: none;
}
.article-variant-nyt .article-content {
  font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
  font-size: 18px;
}
.article-variant-nyt .article-content :deep(p) {
  font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
  font-weight: 400;
  line-height: 1.9;
}
.article-variant-nyt .article-content :deep(h2),
.article-variant-nyt .article-content :deep(h3) {
  font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.article-variant-nyt .article-content :deep(blockquote) {
  font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
}
.article-variant-nyt .article-content :deep(.article-pullquote-underline) {
  font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
}
.article-variant-nyt
  .article-content
  :deep(.article-body--dropcap > p:first-of-type::first-letter) {
  font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
}

/* Responsive — fold the share rail and right column on mobile */
.d-none-mobile {
  display: block;
}
@media (max-width: 1024px) {
  .article-grid {
    grid-template-columns: 1fr;
  }
  .d-none-mobile {
    display: none;
  }
}
</style>
