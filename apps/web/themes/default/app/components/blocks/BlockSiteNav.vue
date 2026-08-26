<script setup lang="ts">
import { useCmsMenu, useSiteSettings } from '~/composables/useCmsFetch';

// Basic theme header: a plain white top bar with the site name (or logo), the
// CMS "main-nav" menu, and a search link. Same data contract as the default
// theme's header (menu_slug option, settings logo/name) but neutral styling,
// no full-screen overlay, and no Decode-specific actions (subscribe/sign-in) or
// fallbacks. useCmsMenu / useSiteSettings are auto-imported across the layers.
const props = defineProps<{
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
}>();

interface NavLink {
  id: string;
  label: string;
  to: string;
  newTab: boolean;
}
interface NavNode extends NavLink {
  children: NavLink[];
}

function optionFlag(key: string): boolean {
  return props.options[key] !== false;
}
const menuSlug = computed(() => {
  const v = props.options['menu_slug'];
  return typeof v === 'string' && v.length > 0 ? v : 'main-nav';
});
const showSearch = computed(() => optionFlag('show_search'));

const { data: settings } = await useSiteSettings();
const { data: menu } = await useCmsMenu(menuSlug.value);

const siteName = computed(() => settings.value?.siteName || 'Site');
const logoUrl = computed<string | null>(() => settings.value?.logoUrl ?? null);

function resolveUrl(item: {
  url: string | null;
  contentSlug: string | null;
}): string {
  if (item.url && item.url.length > 0) return item.url;
  if (item.contentSlug) return `/${item.contentSlug}`;
  return '#';
}

// Minimal neutral fallback — used only when no "main-nav" menu exists.
const FALLBACK_NAV: NavNode[] = [
  { id: 'home', label: 'Home', to: '/', newTab: false, children: [] },
  { id: 'articles', label: 'Articles', to: '/stories', newTab: false, children: [] },
];

const navItems = computed<NavNode[]>(() => {
  const items = menu.value?.items;
  if (!items || items.length === 0) return FALLBACK_NAV;
  return items.map((it) => ({
    id: it.id,
    label: it.label,
    to: it.children.length > 0 ? '#' : resolveUrl(it),
    newTab: it.openInNewTab,
    children: it.children.map((c) => ({
      id: c.id,
      label: c.label,
      to: resolveUrl(c),
      newTab: c.openInNewTab,
    })),
  }));
});

const navOpen = ref(false);
const openDropdown = ref<string | null>(null);
function toggleNav(): void {
  navOpen.value = !navOpen.value;
  if (!navOpen.value) openDropdown.value = null;
}
function toggleDropdown(id: string): void {
  openDropdown.value = openDropdown.value === id ? null : id;
}
function closeAll(): void {
  navOpen.value = false;
  openDropdown.value = null;
}
</script>

<template>
  <nav class="site-header" :class="{ 'nav-open': navOpen }">
    <div class="container nav-row">
      <NuxtLink to="/" class="brand" @click="closeAll">
        <img v-if="logoUrl" :src="logoUrl" :alt="siteName" class="brand-logo" />
        <span v-else class="brand-name">{{ siteName }}</span>
      </NuxtLink>

      <div class="nav-collapse" :class="{ open: navOpen }">
        <ul class="nav-list">
          <template v-for="node in navItems" :key="node.id">
            <li v-if="node.children.length === 0" class="nav-item">
              <NuxtLink
                :to="node.to"
                class="nav-link"
                :target="node.newTab ? '_blank' : undefined"
                :rel="node.newTab ? 'noopener noreferrer' : undefined"
                @click="closeAll"
              >{{ node.label }}</NuxtLink>
            </li>
            <li
              v-else
              class="nav-item dropdown"
              :class="{ show: openDropdown === node.id }"
            >
              <button
                type="button"
                class="nav-link dropdown-toggle"
                :aria-expanded="openDropdown === node.id"
                @click="toggleDropdown(node.id)"
              >{{ node.label }}</button>
              <ul class="dropdown-menu" :class="{ show: openDropdown === node.id }">
                <li v-for="child in node.children" :key="child.id">
                  <NuxtLink
                    :to="child.to"
                    class="dropdown-item"
                    :target="child.newTab ? '_blank' : undefined"
                    :rel="child.newTab ? 'noopener noreferrer' : undefined"
                    @click="closeAll"
                  >{{ child.label }}</NuxtLink>
                </li>
              </ul>
            </li>
          </template>
        </ul>
      </div>

      <div class="header-actions">
        <NuxtLink
          v-if="showSearch"
          to="/search"
          class="btn-search"
          aria-label="Search"
          @click="closeAll"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="icon-sm"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </NuxtLink>
        <button
          type="button"
          class="nav-toggler"
          aria-label="Toggle navigation"
          :aria-expanded="navOpen"
          @click="toggleNav"
        >
          <svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16m-7 6h7"
            />
          </svg>
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.site-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 1000;
}
.container {
  width: 100%;
  max-width: var(--container);
  margin: 0 auto;
  padding: 0 20px;
}
.nav-row {
  display: flex;
  align-items: center;
  height: 60px;
  gap: 24px;
}
.brand {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  flex-shrink: 0;
}
.brand-logo {
  height: 28px;
  width: auto;
  display: block;
}
.brand-name {
  font-weight: 700;
  font-size: 18px;
  color: var(--text);
}

.nav-collapse {
  flex: 1;
  display: flex;
  justify-content: flex-end;
}
.nav-list {
  display: flex;
  align-items: center;
  gap: 24px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.nav-item {
  position: relative;
}
.nav-link {
  color: var(--text);
  font-weight: 500;
  font-size: 15px;
  padding: 8px 0;
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  transition: color var(--transition);
}
.nav-link:hover,
.nav-link.router-link-active {
  color: var(--accent);
}
.dropdown-toggle::after {
  content: '▾';
  margin-left: 4px;
  opacity: 0.6;
}
.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 180px;
  margin: 6px 0 0;
  padding: 6px 0;
  list-style: none;
  box-shadow: var(--shadow);
  display: none;
  z-index: 1001;
}
.dropdown-menu.show {
  display: block;
}
.dropdown-item {
  display: block;
  padding: 8px 16px;
  color: var(--text);
  font-size: 14px;
  text-decoration: none;
}
.dropdown-item:hover {
  background: #f3f4f6;
  color: var(--accent);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.btn-search {
  color: var(--muted);
  display: inline-flex;
  padding: 4px;
  transition: color var(--transition);
}
.btn-search:hover {
  color: var(--text);
}
.nav-toggler {
  background: none;
  border: none;
  color: var(--muted);
  padding: 4px;
  cursor: pointer;
  display: none;
}
.icon-sm {
  width: 22px;
  height: 22px;
}

@media (max-width: 768px) {
  .nav-toggler {
    display: block;
  }
  .nav-collapse {
    position: absolute;
    top: 60px;
    left: 0;
    width: 100%;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 12px 20px;
    display: none;
  }
  .nav-collapse.open {
    display: block;
  }
  .nav-list {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }
  .nav-item {
    border-bottom: 1px solid var(--border);
  }
  .nav-link {
    padding: 12px 0;
    width: 100%;
  }
  .dropdown-menu {
    position: static;
    border: none;
    box-shadow: none;
    padding: 0 0 0 16px;
  }
}
</style>
