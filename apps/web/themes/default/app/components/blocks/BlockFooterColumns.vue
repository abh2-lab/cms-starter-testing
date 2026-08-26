<script setup lang="ts">
import { useCmsMenu, useSiteSettings } from '~/composables/useCmsFetch';

// Basic theme footer grid: site name + link columns from the "footer-nav" menu.
// Neutral — deliberately ignores the Decode-specific fields the shared footer
// part ships (about blurb, socials, newsletter form) so the starter footer
// stays plain regardless of those defaults.
const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();

interface FooterLink {
  id: string;
  label: string;
  to: string;
  newTab: boolean;
}
interface FooterColumn {
  id: string;
  heading: string;
  links: FooterLink[];
}

const menuSlug = computed(() => {
  const v = props.options['menu_slug'];
  return typeof v === 'string' && v.length > 0 ? v : 'footer-nav';
});

const { data: settings } = await useSiteSettings();
const { data: menu } = await useCmsMenu(menuSlug.value);

const siteName = computed(() => settings.value?.siteName || 'Site');

function resolveUrl(item: {
  url: string | null;
  contentSlug: string | null;
}): string {
  if (item.url && item.url.length > 0) return item.url;
  if (item.contentSlug) return `/${item.contentSlug}`;
  return '#';
}

const columns = computed<FooterColumn[]>(() => {
  const items = menu.value?.items;
  if (!items || items.length === 0) return [];
  return items.map((it) => ({
    id: it.id,
    heading: it.label,
    links:
      it.children.length > 0
        ? it.children.map((c) => ({
            id: c.id,
            label: c.label,
            to: resolveUrl(c),
            newTab: c.openInNewTab,
          }))
        : [
            {
              id: it.id,
              label: it.label,
              to: resolveUrl(it),
              newTab: it.openInNewTab,
            },
          ],
  }));
});
</script>

<template>
  <div class="footer-cols">
    <div class="footer-col footer-col-brand">
      <NuxtLink to="/" class="footer-brand">{{ siteName }}</NuxtLink>
    </div>
    <div v-for="col in columns" :key="col.id" class="footer-col">
      <h4 class="footer-heading">{{ col.heading }}</h4>
      <ul class="footer-links">
        <li v-for="link in col.links" :key="link.id">
          <NuxtLink
            :to="link.to"
            :target="link.newTab ? '_blank' : undefined"
            :rel="link.newTab ? 'noopener noreferrer' : undefined"
          >{{ link.label }}</NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.footer-cols {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 32px;
  margin-bottom: 32px;
}
.footer-col {
  min-width: 0;
}
.footer-brand {
  font-weight: 700;
  font-size: 18px;
  color: var(--text);
  text-decoration: none;
}
.footer-heading {
  color: var(--text);
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 14px;
}
.footer-links {
  list-style: none;
  padding: 0;
  margin: 0;
}
.footer-links li {
  margin-bottom: 10px;
}
.footer-links a {
  color: var(--muted);
  font-size: 14px;
  text-decoration: none;
}
.footer-links a:hover {
  color: var(--accent);
}
@media (max-width: 768px) {
  .footer-cols {
    grid-template-columns: 1fr 1fr;
  }
  .footer-col-brand {
    grid-column: 1 / -1;
  }
}
@media (max-width: 480px) {
  .footer-cols {
    grid-template-columns: 1fr;
  }
}
</style>
