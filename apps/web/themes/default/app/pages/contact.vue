<script setup lang="ts">
import { useSystemView } from '~/composables/useSystemView';

// /contact is now an override-backed system template (theme engine v2 Phase 4):
// this page composes the `contact` role and renders its block tree. The
// contact-form block carries the heading, intro and form (and POSTs the
// submission itself), so the page is a thin shell an admin can restructure.
const { data: view } = await useSystemView('contact');
const blocks = computed(() => view.value?.blocks ?? []);

// Keep the browser-tab title in sync with the (editable) form heading.
const heading = computed<string>(() => {
  const form = view.value?.blocks?.find((b) => b.key === 'contact-form');
  const h = form?.fields?.['heading'];
  return typeof h === 'string' && h.length > 0 ? h : 'Contact';
});

useHead(() => ({ title: heading.value }));
</script>

<template>
  <!-- Same shell PageView renders for every other page. Without it /contact sat
       outside `.cms-page` / `.cms-page-blocks`, so any page-level rule hung off
       those hooks silently skipped this one page. -->
  <article class="cms-page">
    <div class="cms-page-blocks">
      <BlockTree :blocks="blocks" />
    </div>
  </article>
</template>
