<script setup lang="ts">
import { useCmsPart, useSiteSettings } from '~/composables/useCmsFetch';
import BlockTree from '~/components/BlockTree.vue';

// Chrome data fetched once for the layout; pages re-using these composables
// share Nuxt's useAsyncData slot and the payload survives SSR without an
// extra round trip.
//
// Theme engine v1.5: the header and footer render from composed template
// PARTS (partRegistry in @cms/blocks → /api/public/parts/:key) instead of
// the hand-built SiteHeader/SiteFooter components. The part payloads are
// structure-only — the site-nav / footer blocks fetch their own menus
// ("main-nav" / "footer-nav") and the settings logo exactly as the old
// components did, with the same built-in fallbacks. The layout keeps the
// footer SHELL (background + container) so the footer bands stay bands.
//
// Site settings stay fetched here for the maintenance banner (the chrome
// blocks reuse the same useAsyncData slot for the logo).
const { data: settings } = await useSiteSettings();
const { data: headerPart } = await useCmsPart('header');
const { data: footerPart } = await useCmsPart('footer');

const headerBlocks = computed(() => headerPart.value?.blocks ?? []);
const footerBlocks = computed(() => footerPart.value?.blocks ?? []);

const maintenance = computed<boolean>(() => {
  const raw = settings.value as
    | (Record<string, unknown> & { maintenanceMode?: unknown })
    | null;
  return Boolean(raw?.['maintenanceMode']);
});

// Favicon comes from Site Settings (admin → Branding → Favicon): the API
// resolves the stored object key to a display URL (settings.faviconUrl). Emit it
// as the document icon here so the publisher's favicon shows site-wide — this
// layout also wraps error.vue, so 404/500 pages get it too. No faviconUrl ⇒ no
// link emitted, and the browser falls back to the default /favicon.ico.
const faviconUrl = computed<string | null>(
  () => settings.value?.faviconUrl ?? null,
);
useHead(
  computed(() => ({
    link: faviconUrl.value
      ? [{ rel: 'icon', href: faviconUrl.value, key: 'site-favicon' }]
      : [],
  })),
);
</script>

<template>
  <div class="page-shell">
    <div v-if="maintenance" class="maintenance-banner" role="status">
      Maintenance mode is on. Some content may be hidden.
    </div>

    <BlockTree :blocks="headerBlocks" />

    <main>
      <slot />
    </main>

    <footer v-if="footerBlocks.length" class="site-footer">
      <div class="container-custom">
        <BlockTree :blocks="footerBlocks" />
      </div>
    </footer>
  </div>
</template>

<style scoped>
.page-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
main {
  flex: 1;
}
.maintenance-banner {
  background: #fef3c7;
  color: #78350f;
  padding: var(--space-2) var(--space-4);
  text-align: center;
  font-size: var(--fs-sm);
  border-bottom: 1px solid #fde68a;
}

/* Footer SHELL — the bands inside it are blocks (BlockFooterColumns /
   BlockFooterBottom); the dark canvas stays layout chrome. The width comes
   from the global .container-custom in theme.css — never re-declare it here. */
.site-footer {
  background-color: #0f2d96;
  /* --section-y, not a fixed 80px, so the footer breathes like every other band
     and halves itself on phones without a media query here. */
  padding: var(--section-y) 0 var(--space-6);
}
</style>
