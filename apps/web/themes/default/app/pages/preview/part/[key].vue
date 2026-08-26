<script setup lang="ts">
import { cmsFetch, type PartPayload } from '~/composables/useCmsFetch';
import BlockTree from '~/components/BlockTree.vue';

// No site layout — the default layout mounts the header + footer parts on
// every page, which would wrap (and double-render) the very part we're
// previewing. layout:false renders the part ALONE so the editor sees exactly
// what it's editing.
definePageMeta({ layout: false });

// Bare part-preview page. Powers the structure editor's iframe when editing a
// PART (header / footer / sidebar): it renders ONLY that part — no site
// header, footer, or page chrome around it — so "editing the header" shows
// just the header, not a whole article wrapped around it.
//
// Forwards ?theme_preview=<token> to /api/public/parts/:key so the composed
// blocks reflect the editor's DRAFT override (the API verifies the token,
// resolves the draft, and sends no-store). Without a token it renders the
// live/published part. Uses the SAME registry the live site uses, so the
// preview is byte-identical to production.

const route = useRoute();
const partKey = computed(() => {
  const raw = route.params['key'];
  return typeof raw === 'string' ? raw : '';
});
const themePreview = computed<string | null>(() => {
  const raw = route.query['theme_preview'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

const { data: part } = await useAsyncData(
  () => `part-preview:${partKey.value}:${themePreview.value ?? 'live'}`,
  () =>
    cmsFetch<PartPayload>(
      `/api/public/parts/${encodeURIComponent(partKey.value)}`,
      themePreview.value ? { theme_preview: themePreview.value } : undefined,
    ),
  { watch: [partKey, themePreview] },
);

if (!part.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Part not found',
    fatal: true,
  });
}

useHead(() => ({
  title: part.value ? `Preview: ${part.value.key}` : 'Part preview',
  // Editor utility — keep it out of search indices entirely.
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
}));
</script>

<template>
  <div v-if="part" class="part-preview">
    <BlockTree :blocks="part.blocks" />
  </div>
</template>

<style scoped>
/* No page chrome on purpose — the part renders alone so the editor sees only
   what it's editing. Minimal frame so an isolated header/footer still reads. */
.part-preview {
  min-height: 100vh;
  background: #fff;
}
</style>
