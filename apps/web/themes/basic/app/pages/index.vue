<script setup lang="ts">
import { cmsFetch } from '../../../default/app/composables/useCmsFetch';
import { useBlockRegistry } from '~/composables/useBlockRegistry';

// Basic theme homepage. Identical to the default theme's index.vue; it exists
// as a layer override so `useBlockRegistry` resolves (via `~`) to the BASIC
// registry — routing the home's inline block resolve through the neutral
// blocks. cmsFetch is imported from the default layer (shared data access).
// Homepage = a CMS dynamic page with slug `home`.

interface PageSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
}

interface ComposedBlock {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
  error?: 'load_failed' | 'unknown_block';
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
  blocks: ComposedBlock[];
}

const { data: page } = await useAsyncData('home', () =>
  cmsFetch<PagePayload>('/api/public/pages/home'),
);

const registry = useBlockRegistry();

interface ResolvedBlock {
  block: ComposedBlock;
  component: ReturnType<typeof useBlockRegistry>[string] | null;
}

const resolvedBlocks = computed<ResolvedBlock[]>(() => {
  if (!page.value || page.value.type !== 'dynamic') return [];
  return page.value.blocks.map((b) => ({
    block: b,
    component: registry[b.key] ?? null,
  }));
});

const isStatic = computed(() => page.value?.type === 'static');
const isDynamic = computed(() => page.value?.type === 'dynamic');

useHead(() => {
  const p = page.value;
  if (!p) return { title: 'Home' };
  return {
    title: p.seo.metaTitle ?? p.title,
    meta: p.seo.metaDescription
      ? [{ name: 'description', content: p.seo.metaDescription }]
      : [],
  };
});
</script>

<template>
  <article class="cms-page">
    <template v-if="isStatic && page">
      <Head>
        <Style>{{ page.css ?? '' }}</Style>
      </Head>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="cms-page-body" v-html="page.html ?? ''"></div>
    </template>

    <template v-else-if="isDynamic && page">
      <div v-if="page.blocks.length === 0" class="cms-onboarding container">
        <h1>{{ page.title }}</h1>
        <p>This home page has no blocks yet. Open it in the admin and add some.</p>
      </div>
      <div v-else class="cms-page-blocks">
        <template v-for="rb in resolvedBlocks" :key="rb.block.id">
          <component
            :is="rb.component"
            v-if="rb.component && !rb.block.error"
            :fields="rb.block.fields"
            :options="rb.block.options"
            :data="rb.block.data"
          />
          <div v-else-if="rb.block.error === 'unknown_block'" class="block-error">
            <p>
              Block <code>{{ rb.block.key }}</code> is referenced by this page
              but not registered in the renderer.
            </p>
          </div>
          <div v-else-if="rb.block.error === 'load_failed'" class="block-error">
            <p>Block <code>{{ rb.block.key }}</code> failed to load.</p>
          </div>
        </template>
      </div>
    </template>

    <div v-else class="cms-onboarding container">
      <h1>No home page configured</h1>
      <p>
        Create a Page in admin with slug <code>home</code> (dynamic type, using
        a template such as <code>home-default</code>) and publish it. This view
        will then render its blocks.
      </p>
      <p class="cms-onboarding-links">
        <NuxtLink to="/stories" class="btn-outline">Browse articles</NuxtLink>
        <NuxtLink to="/search" class="btn-outline">Search</NuxtLink>
      </p>
    </div>
  </article>
</template>

<style scoped>
.cms-page {
  display: block;
}
.cms-onboarding {
  padding: 60px 20px;
  max-width: 720px;
  text-align: left;
}
.cms-onboarding h1 {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 12px;
}
.cms-onboarding p {
  color: var(--muted);
  margin-bottom: 12px;
}
.cms-onboarding code {
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.9em;
}
.cms-onboarding-links {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.block-error {
  max-width: var(--container);
  margin: 16px auto;
  padding: 12px 16px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  border-radius: var(--radius);
  color: #b91c1c;
  font-size: 14px;
}
.block-error code {
  background: rgba(0, 0, 0, 0.05);
  padding: 0 4px;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
}
</style>
