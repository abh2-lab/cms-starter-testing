<script setup lang="ts">
import { cmsFetch } from '~/composables/useCmsFetch';
import PageView from '~/components/PageView.vue';
import CategoryArchiveView from '~/components/CategoryArchiveView.vue';
import TagArchiveView from '~/components/TagArchiveView.vue';

// Root-level resolver for the flat-URL world.
//
// Decode's URL contract puts static pages, category archives and tag
// archives all at the publication root: /about, /young-minds,
// /digital-rights are all single-segment URLs. This file resolves which
// kind of thing a given /<slug> is by asking /api/public/resolve, then
// renders the matching view component. Cross-table slug uniqueness
// (commit 1.3) means at most one kind ever matches.
//
// Nuxt's named/static routes win first: /, /contact, /search, /authors,
// /author/<slug>, /uncategorized/<slug>, /preview/<...>, /stories all
// resolve to their dedicated routes before /<slug> falls through here.
//
// Two-segment URLs /<category>/<article> are handled by the sibling
// [article].vue at this same nesting depth, NOT by this resolver.
//
// LAYOUT: this route picks its own layout per-resolution — a chromeless (Blank)
// page renders in the `blank` layout (no header/footer), everything else in
// `default`. We opt out of the app-shell layout (`layout: false`) and wrap the
// view in an explicit <NuxtLayout :name>, so the choice is part of the page
// template and therefore correct at SSR (unlike setPageLayout(), which only
// affects client-side navigation). Because `layoutName` is reactive, navigating
// between a Blank page and a normal one swaps the chrome both ways.
definePageMeta({ layout: false });

interface ResolvePayload {
  kind: 'page' | 'category' | 'tag' | null;
  slug: string;
  // True for a static page using a chromeless (Blank) layout — render with no
  // site header/footer. Computed server-side from the page-layout registry.
  chromeless: boolean;
}

const route = useRoute();
const slug = computed(() => {
  const raw = route.params['slug'];
  return typeof raw === 'string' ? raw : '';
});

const { data: resolved } = await useAsyncData(
  () => `resolve:${slug.value}`,
  () =>
    cmsFetch<ResolvePayload>(
      `/api/public/resolve/${encodeURIComponent(slug.value)}`,
    ),
  { watch: [slug] },
);

// kind=null comes back as a 200 from the API (not 404) so we can render
// a frontend 404 cleanly. cmsFetch unwraps {data: ...} so resolved.value
// is the payload itself — null only if the API endpoint genuinely errored.
const kind = computed<'page' | 'category' | 'tag' | null>(
  () => resolved.value?.kind ?? null,
);

// Chromeless (Blank) pages render in the `blank` layout (no header/footer);
// everything else uses `default`. Reactive, so client navigation swaps the
// chrome both ways with no stuck state.
const layoutName = computed<'default' | 'blank'>(() =>
  resolved.value?.chromeless ? 'blank' : 'default',
);

if (kind.value === null) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not found',
    fatal: true,
  });
}
</script>

<template>
  <NuxtLayout :name="layoutName">
    <PageView v-if="kind === 'page'" :slug="slug" />
    <CategoryArchiveView v-else-if="kind === 'category'" :slug="slug" />
    <TagArchiveView v-else-if="kind === 'tag'" :slug="slug" />
  </NuxtLayout>
</template>
