<script setup lang="ts">
import { cmsFetch, type StoryDetail } from '~/composables/useCmsFetch';
import type { ComposedBlock } from '~/composables/useBlockRegistry';
import { useThemePreviewToken } from '~/composables/useThemePreviewToken';
import { portfolioUrl } from '~/utils/urls';
import BlockTree from '~/components/BlockTree.vue';

// Portfolio detail view — the isolated shell for a single Portfolio entry.
// Deliberately standalone (it does NOT import or extend ArticleView) so the
// news article pages can never be affected by portfolio changes. It fetches the
// composed `single-portfolio` template from the same CPT-generic content
// endpoint, then places each block by its `region` option:
//   hero  — full-width dark title band above the grid;
//   main  — left column (the thumbnail);
//   body  — left column rich-text body (wrapped in .portfolio-body typography);
//   aside — right column (share buttons + contact card);
//   outro — full-width previous/next row below the grid.
// The optional sub-heading (custom_fields.subtitle) is drawn here as shell
// chrome above the thumbnail.
const props = defineProps<{
  slug: string;
}>();

const route = useRoute();
const slug = computed(() => props.slug);
const contentType = 'portfolio';

// Admin "Preview" token — forwarded so the content endpoint returns the row
// regardless of publish state. Keyed into the async key so a preview session
// and a public visit never share a Nuxt cache entry.
const previewToken = computed(() => {
  const raw = route.query['preview'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});
// Structure-editor iframe token — composed template resolves DRAFT overrides.
const themePreview = useThemePreviewToken();

const { data: story } = await useAsyncData(
  () =>
    `portfolio:${slug.value}:${previewToken.value ?? 'public'}:${themePreview.value ?? 'live'}`,
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
    statusMessage: 'Portfolio entry not found',
    fatal: true,
  });
}

// Bucket the composed blocks by their `region` option. An unknown/missing
// region falls into `main` so a malformed (future) override never loses content.
const KNOWN_REGIONS = ['hero', 'main', 'body', 'aside', 'outro'] as const;
type Region = (typeof KNOWN_REGIONS)[number];
const regions = computed<Record<Region, ComposedBlock[]>>(() => {
  const buckets: Record<Region, ComposedBlock[]> = {
    hero: [],
    main: [],
    body: [],
    aside: [],
    outro: [],
  };
  for (const block of story.value?.blocks ?? []) {
    const raw = block.options?.['region'];
    const region: Region =
      typeof raw === 'string' && (KNOWN_REGIONS as readonly string[]).includes(raw)
        ? (raw as Region)
        : 'main';
    buckets[region].push(block);
  }
  return buckets;
});
const heroBlocks = computed(() => regions.value.hero);
const mainBlocks = computed(() => regions.value.main);
const bodyBlocks = computed(() => regions.value.body);
const asideBlocks = computed(() => regions.value.aside);
const outroBlocks = computed(() => regions.value.outro);

const cf = computed(() => story.value?.customFields ?? {});

// Optional sub-heading (drawn as shell chrome above the thumbnail).
const subtitle = computed<string>(() => {
  const v = cf.value['subtitle'];
  return typeof v === 'string' ? v.trim() : '';
});

// og:image — an editor SEO image wins; otherwise the resolved hero image.
const ogImage = computed<string | null>(() => {
  if (story.value?.seo?.ogImageUrl) return story.value.seo.ogImageUrl;
  const v = cf.value['heroImageUrl'];
  return typeof v === 'string' ? v : null;
});

// The entry's category (its portfolio-categories term) — the first segment of
// the canonical URL, /<category>/<slug>. null falls back to a /portfolio/
// prefix inside portfolioUrl.
const categorySlug = computed<string | null>(() => {
  const term = (story.value?.taxonomy ?? []).find(
    (t) => t.taxonomySlug === 'portfolio-categories',
  );
  return term?.termSlug ?? null;
});

// Canonical — an editor-set SEO canonical wins; otherwise origin + the clean
// /<category>/<slug> path (the preview ?token is intentionally dropped).
const requestUrl = useRequestURL();
const canonicalHref = computed<string | null>(() => {
  const explicit = story.value?.seo?.canonicalUrl;
  if (explicit && explicit.length > 0) return explicit;
  if (!story.value) return null;
  return `${requestUrl.origin}${portfolioUrl(story.value.slug, categorySlug.value)}`;
});

useHead(() => ({
  title: story.value
    ? (story.value.seo?.metaTitle ?? story.value.title)
    : 'Portfolio',
  meta: [
    {
      name: 'description',
      content: story.value?.seo?.metaDescription ?? story.value?.title ?? '',
    },
    ...(ogImage.value
      ? [{ property: 'og:image', content: ogImage.value }]
      : []),
  ],
  link: canonicalHref.value
    ? [{ rel: 'canonical', href: canonicalHref.value }]
    : [],
}));
</script>

<template>
  <article v-if="story" class="portfolio-page">
    <div
      v-if="previewToken"
      class="preview-banner container-custom"
      role="status"
    >
      <strong>Preview</strong>
      <span>This view bypasses the publish filter and may show drafts.</span>
    </div>

    <!-- ═══ TITLE BAND (composed `hero` region) ═══ -->
    <BlockTree :blocks="heroBlocks" />

    <!-- ═══ BODY (2-column grid) ═══ -->
    <section class="portfolio-body-section">
      <div class="container-custom">
        <div class="portfolio-grid">
          <!-- Left: sub-heading, thumbnail, rich-text body -->
          <div class="portfolio-main-col">
            <p v-if="subtitle" class="portfolio-subtitle">{{ subtitle }}</p>
            <BlockTree :blocks="mainBlocks" />
            <div class="portfolio-body">
              <BlockTree :blocks="bodyBlocks" />
            </div>
          </div>

          <!-- Right: share buttons + contact card -->
          <aside class="portfolio-aside-col">
            <div class="portfolio-aside">
              <BlockTree :blocks="asideBlocks" />
            </div>
          </aside>
        </div>

        <!-- Full-width previous/next row -->
        <div class="portfolio-outro">
          <BlockTree :blocks="outroBlocks" />
        </div>
      </div>
    </section>
  </article>
</template>

<style scoped>
/* No local `.container-custom` here on purpose — the page uses the global one
   from theme.css (1200px, PING gutters) so the hero band, the body and the
   site header all line up. Re-declaring it (the old 1440px override) is the
   exact trap the design guide warns about. */
.portfolio-page {
  background: #fff;
  color: #0f2d96;
}
.preview-banner {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  background: #fef3c7;
  color: #78350f;
  border: 1px solid #fde68a;
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  margin: 12px auto;
  max-width: 1300px;
}
.preview-banner strong {
  font-weight: var(--fw-bold);
}

/* ─── Body / 2-col grid ─────────────────────────────────────────────── */
.portfolio-body-section {
  padding: var(--space-8) 0 var(--space-10);
  background: #fff;
}
.portfolio-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: var(--space-9);
  align-items: start;
}
.portfolio-main-col {
  min-width: 0;
}
.portfolio-aside-col {
  min-width: 0;
}
.portfolio-aside {
  position: sticky;
  /* Sticky offset is derived from the header height, never a magic number. */
  top: calc(var(--header-h) + var(--space-5));
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* Sub-heading — bold navy line with an orange accent bar, above the thumbnail. */
.portfolio-subtitle {
  margin: 0 0 var(--space-5);
  padding-left: var(--space-4);
  border-left: 4px solid #ff6a4d;
  font-size: var(--fs-h4);
  font-weight: var(--fw-semibold);
  color: #0f2d96;
  line-height: var(--lh-snug);
}

/* Give the thumbnail some breathing room before the body. */
.portfolio-main-col :deep(.block-featured-image) {
  margin: 0 0 var(--space-6);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* ─── Rich-text body typography (PING navy + role tokens) ───────────── */
/* Scoped to .portfolio-body so nothing here can touch the news article styles.
   Colours are PING navy, sizes are role tokens (never literals). */
.portfolio-body {
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: #0f2d96;
}
.portfolio-body :deep(p) {
  margin: 0 0 var(--space-5);
}
.portfolio-body :deep(h2) {
  font-size: var(--fs-h2);
  font-weight: var(--fw-bold);
  color: #0f2d96;
  margin: var(--space-8) 0 var(--space-4);
  line-height: var(--lh-tight);
}
.portfolio-body :deep(h3) {
  font-size: var(--fs-h3);
  font-weight: var(--fw-bold);
  color: #0f2d96;
  margin: var(--space-7) 0 var(--space-3);
  line-height: var(--lh-tight);
}
.portfolio-body :deep(ul),
.portfolio-body :deep(ol) {
  margin: 0 0 var(--space-5);
  padding-left: var(--space-5);
}
.portfolio-body :deep(li) {
  margin-bottom: var(--space-2);
}
.portfolio-body :deep(a) {
  color: #0f2d96;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: color var(--motion-fast) var(--ease-out);
}
.portfolio-body :deep(a:hover) {
  color: #ff6a4d;
}
.portfolio-body :deep(strong) {
  font-weight: var(--fw-bold);
  color: #0f2d96;
}
.portfolio-body :deep(blockquote) {
  margin: var(--space-6) 0;
  padding-left: var(--space-5);
  border-left: 4px solid #ff6a4d;
  font-size: var(--fs-lead);
  line-height: var(--lh-body);
  font-style: italic;
  color: #0f2d96;
}
.portfolio-body :deep([data-lead]) {
  font-size: var(--fs-lead);
  line-height: var(--lh-body);
  font-weight: var(--fw-medium);
  color: #0f2d96;
  margin: 0 0 var(--space-5);
}
.portfolio-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-lg);
}

.portfolio-outro {
  margin-top: var(--space-8);
}

/* ─── Responsive — stack to one column ──────────────────────────────── */
@media (max-width: 1024px) {
  .portfolio-grid {
    grid-template-columns: 1fr;
    gap: var(--space-7);
  }
  .portfolio-aside {
    position: static;
  }
}
</style>
