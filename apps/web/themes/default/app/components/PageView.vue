<script setup lang="ts">
import { cmsFetch } from '~/composables/useCmsFetch';
import type { ComposedBlock } from '~/composables/useBlockRegistry';
import { resolvePageLayoutComponent } from '~/composables/usePageLayouts';

// Root-level catch-all for admin-managed CMS pages.
//
// Nuxt's named/static routes match before this catch-all, so /, /contact,
// /search, /article/<slug>, /stories, /news (alias of /stories), and the
// /preview/* tree all resolve to their dedicated pages first. Anything else
// — a single-segment path like /about or /dynamic-testing — falls through
// here and tries to load a page by that slug. The admin write API rejects
// pages with slugs that would shadow a named route (see
// apps/api/src/lib/reserved-slugs.ts), so we can't end up shadowed by a
// runaway tenant.
//
// Two flavours from the API:
//   - type: 'static'  → render the sanitized html with the scoped css inlined.
//   - type: 'dynamic' → walk blocks[] and resolve each to a component via the
//     block registry. The API pre-resolves block data server-side (parallel
//     loaders with per-block error isolation) so this renderer is pure.
//
// Preview support mirrors article/[slug].vue: ?preview=<token> forwards the
// token to the API, which bypasses both the published-status filter and the
// public cache. The useAsyncData key includes the token so a preview session
// and a regular visit don't share Nuxt's SWR slot.

interface PageSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
}

interface PagePayload {
  id: string;
  title: string;
  slug: string;
  type: 'static' | 'dynamic';
  publishedAt: string | null;
  seo: PageSeo;
  html: string | null;
  css: string | null;
  // Static branch. `layoutTemplate` selects the wrapper shell; `contentMode`
  // chooses how the body renders — 'normal' = TipTap JSON in `body` (rendered
  // via ContentBody/renderTiptap), 'raw' = html/css verbatim.
  layoutTemplate: string | null;
  contentMode: 'normal' | 'raw';
  body: unknown;
  blocks: ComposedBlock[];
}

// Static / dynamic CMS page render. Driven by a `slug` prop so the root
// resolver (pages/[slug]/index.vue) can pass the resolved page slug after
// /api/public/resolve returns kind='page'.
const props = defineProps<{
  slug: string;
}>();

const route = useRoute();
const slug = computed(() => props.slug);

const previewToken = computed(() => {
  const raw = route.query['preview'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

const { data: page } = await useAsyncData(
  () => `page:${slug.value}:${previewToken.value ?? 'public'}`,
  () =>
    cmsFetch<PagePayload>(
      `/api/public/pages/${encodeURIComponent(slug.value)}`,
      previewToken.value ? { preview: previewToken.value } : undefined,
    ),
  { watch: [slug, previewToken] },
);

if (!page.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Page not found',
    fatal: true,
  });
}

// SEO meta — pull from page.seo with sensible defaults. metaTitle falls back
// to the page title; meta description, og:image, and canonical are emitted
// only when set.
useHead(() => {
  const p = page.value;
  if (!p) return {};
  const titleParts = [p.seo.metaTitle ?? p.title];
  const robots = `${p.seo.robotsIndex ? 'index' : 'noindex'},${p.seo.robotsFollow ? 'follow' : 'nofollow'}`;
  const meta: Array<{ name?: string; property?: string; content: string }> = [
    { name: 'robots', content: robots },
  ];
  if (p.seo.metaDescription) {
    meta.push({ name: 'description', content: p.seo.metaDescription });
  }
  if (p.seo.ogImageUrl) {
    meta.push({ property: 'og:image', content: p.seo.ogImageUrl });
  }
  meta.push({ property: 'og:title', content: titleParts[0]! });
  meta.push({ property: 'og:type', content: 'website' });
  const link = p.seo.canonicalUrl
    ? [{ rel: 'canonical', href: p.seo.canonicalUrl }]
    : [];
  return { title: titleParts[0], meta, link };
});

const isStatic = computed(() => page.value?.type === 'static');
const isDynamic = computed(() => page.value?.type === 'dynamic');

// The developer-coded wrapper shell for this static page (container width /
// heading). Unknown / legacy ids fall back to the Default layout.
const layoutComponent = computed(() =>
  resolvePageLayoutComponent(page.value?.layoutTemplate ?? null),
);
</script>

<template>
  <article class="cms-page">
    <!-- Static branch — raw HTML + raw CSS from the API, stored verbatim by
         the admin-only authoring surface. There is intentionally NO server-
         side sanitization and NO per-page CSS scoping: pasted rules like
         `body { … }` apply globally to the rendered document, which is what
         the admin wrote.
         Note: <script> tags inside page.html will NOT execute. v-html
         compiles down to setting innerHTML, and browsers refuse to run
         scripts inserted that way — by design. Tracking scripts belong in
         the (forthcoming) Extra <head> field, which the public renderer
         injects via useHead so they execute on page load. -->
    <template v-if="isStatic && page">
      <!-- Raw mode only: the admin's scoped CSS goes in a <style> tag. Normal
           (TipTap) mode has no raw CSS. -->
      <Head v-if="page.contentMode === 'raw'">
        <Style>{{ page.css ?? '' }}</Style>
      </Head>
      <!-- The page body renders INSIDE the resolved layout wrapper (container
           width / heading). Normal mode → ContentBody (TipTap JSON → HTML);
           Raw mode → the pasted HTML verbatim (admin-only, intentionally
           unsanitized). -->
      <component :is="layoutComponent" :title="page.title">
        <!-- LazyContentBody, not ContentBody: ContentBody statically imports
             renderTiptap → sanitize-html → postcss, which drags the Node
             built-ins path/url/source-map-js into whatever chunk references it.
             PageView renders EVERY CMS page, so a plain <ContentBody> here put
             that whole chain in the client bundle for the home page and every
             marketing page — none of which ever render a TipTap body — and
             filled the dev console with Vite's "module externalized for browser
             compatibility" warnings.
             The Lazy prefix makes it an async component, so Vite code-splits it
             and it loads only when a static, normal-mode page actually renders.
             SSR is unaffected: Vue resolves async components server-side, so the
             HTML is still fully rendered.
             useBlockRegistry.ts does the same thing, for the same reason, to the
             post-content and custom-field blocks — this was the one route into
             the chain that pass missed. -->
        <LazyContentBody
          v-if="page.contentMode === 'normal' && page.body"
          :doc="page.body"
        />
        <!-- eslint-disable-next-line vue/no-v-html — admin-only authoring surface, intentionally unsanitized -->
        <div v-else-if="page.contentMode === 'raw'" class="cms-page-body" v-html="page.html ?? ''"></div>
      </component>
    </template>

    <!-- Dynamic branch — block composer + registry are live. Each block
         component receives the API-resolved `fields`, `options`, and
         `data` props. A block whose key isn't in the local registry is
         skipped (dev gets a console warning); a block that failed to load
         on the API side ships `data: null` + an `error` marker and renders
         a degraded placeholder. -->
    <template v-else-if="isDynamic && page">
      <div v-if="page.blocks.length === 0" class="cms-page-placeholder">
        <h1>{{ page.title }}</h1>
        <p>
          This dynamic page has no blocks yet. Open it in the admin editor
          and apply a template, or add blocks one at a time.
        </p>
      </div>
      <div v-else class="cms-page-blocks">
        <BlockTree :blocks="page.blocks" />
      </div>
    </template>
  </article>
</template>

<style scoped>
.cms-page {
  /* Wrapper for any chrome we add later (breadcrumbs, share bar). The body
     div carries its own data-page-id and scoped styles, so we keep this
     container minimal. */
  display: block;
}

.cms-page-placeholder {
  max-width: 64rem;
  margin: 4rem auto;
  padding: 2rem;
  text-align: center;
  color: var(--color-fg, #444);
}

.cms-page-placeholder h1 {
  font-size: 2rem;
  margin-bottom: 1rem;
}

.cms-page-blocks {
  display: block;
  /* The positioning anchor for the `page-art` block, which renders an
     absolutely-positioned stroke meant to span the whole page. Without this the
     stroke would attach to the viewport instead and scroll away. Harmless on
     pages that don't use it — `relative` with no offsets moves nothing. */
  position: relative;
}
/* Every block paints ABOVE the page art. Scoped to direct children so a block's
   own internal layering is untouched. Deep, because these are child components'
   root elements.
   The :not(.pa) matters: the page-art block positions itself ABSOLUTELY to fill
   this wrapper, and blanket `position: relative` here overrode that — its
   height: 100% then fell back to the SVG's own 1440:4200 aspect ratio and the
   stroke covered only the top 40% of the page. */
.cms-page-blocks > :deep(*:not(.pa)) {
  position: relative;
  z-index: 1;
}
</style>
