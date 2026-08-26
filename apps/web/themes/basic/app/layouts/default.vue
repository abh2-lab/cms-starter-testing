<script setup lang="ts">
import { useCmsPart, useSiteSettings } from '../../../default/app/composables/useCmsFetch';

// Basic theme layout — same structure as the default theme's layout (header
// part → main → footer part), but with a NEUTRAL footer shell (light canvas,
// standard container width) instead of the Decode dark band. useCmsPart /
// useSiteSettings and <BlockTree> are auto-imported across the layer stack.
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
      <div class="container">
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
  padding: 8px 16px;
  text-align: center;
  font-size: 13px;
  border-bottom: 1px solid #fde68a;
}

/* Neutral footer shell — light band, standard container. The footer bands
   inside are blocks (BlockFooterColumns / BlockFooterBottom). */
.site-footer {
  background: #fafafa;
  border-top: 1px solid var(--border);
  padding: 48px 0 24px;
}
.container {
  width: 100%;
  max-width: var(--container);
  margin: 0 auto;
  padding: 0 20px;
}
</style>
