<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  RouterLink,
  RouterView,
  useRoute,
  useRouter,
  type RouteLocationRaw,
} from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useTheme } from '@/composables/useTheme';
import { useHelp } from '@/composables/useHelp';
import Icon from '@/components/Icon.vue';
import UpdateBanner from '@/components/UpdateBanner.vue';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const { theme, toggleTheme } = useTheme();
const help = useHelp();

const BRAND = 'CMS Admin';

async function onLogout(): Promise<void> {
  await auth.logout();
  await router.push({ name: 'login' });
}

const userInitial = computed(() =>
  (auth.user?.displayName || auth.user?.email || '?').charAt(0).toUpperCase(),
);

// ── Inline SVG icon set (trusted, static markup injected as inner SVG) ──
const NAV_ICONS: Record<string, string> = {
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  types:
    '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  media:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  taxonomy:
    '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  menus:
    '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  redirects:
    '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  users:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  webhook:
    '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81a3 3 0 0 0 0-6 3 3 0 0 0-3 3c0 .24.04.47.09.7L8.04 9.81A2.98 2.98 0 0 0 6 9a3 3 0 0 0 0 6c.88 0 1.67-.36 2.25-.94l7.05 4.11c-.05.21-.08.43-.08.65a3 3 0 1 0 3-2.73z"/>',
  envelope:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/>',
  infrastructure:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  dot: '<circle cx="12" cy="12" r="2.5"/>',
  list: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  queue:
    '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7" cy="6" r="1" fill="currentColor"/><circle cx="7" cy="12" r="1" fill="currentColor"/><circle cx="7" cy="18" r="1" fill="currentColor"/>',
  docs:
    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  refresh:
    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
};

interface NavLink {
  key: string;
  label: string;
  /** Internal Vue route. Either `to` OR `href` must be set, not both. */
  to?: RouteLocationRaw;
  /**
   * External URL (rendered as `<a target="_blank">`). Used for surfaces that
   * are server-rendered outside the Vue admin shell — e.g. Bull Board at
   * /api/admin/queues, which is a Bull Board static UI, not a Vue route.
   */
  href?: string;
  active: boolean;
  icon: string;
  /** Anchors the welcome tour: each tour step targets a selector matching
   *  this id (e.g. nav-home → [data-tour-id="nav-home"]). Set on the first
   *  link of each top-level sidebar section.
   */
  dataTourId?: string;
}
interface NavSection {
  key: string;
  title: string | null;
  links: NavLink[];
}

// Welcome-tour auto-trigger disabled — onboarding flow is broken; not fixing now.
// (Per #6) Per-content-type sidebar links removed; the single "All Content"
// link plus the type filter inside ContentList.vue replaces them.

function pathActive(prefix: string, exact = false): boolean {
  if (exact) return route.path === prefix;
  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}

// Sidebar sections, gated by role. Only links to routes that exist today are
// listed. Role mapping per spec: manager≈admin, contributor≈author.
const sections = computed<NavSection[]>(() => {
  const out: NavSection[] = [
    {
      key: 'top',
      title: null,
      links: [
        {
          key: 'home',
          label: 'Dashboard',
          to: { name: 'home' },
          active: pathActive('/', true),
          icon: 'dashboard',
          dataTourId: 'nav-home',
        },
      ],
    },
  ];

  out.push({
    key: 'content',
    title: 'Content',
    links: [
      {
        key: 'content-all',
        label: 'All Content',
        to: { name: 'content' },
        active: route.path === '/content' && !route.query['type'],
        icon: 'file',
        dataTourId: 'nav-content',
      },
    ],
  });

  out.push({
    key: 'media',
    title: 'Media',
    links: [
      {
        key: 'media',
        label: 'Media Library',
        to: { name: 'media' },
        active: pathActive('/media'),
        icon: 'media',
        dataTourId: 'nav-media',
      },
    ],
  });

  if (auth.hasRole('editor')) {
    out.push({
      key: 'taxonomy',
      title: 'Taxonomy',
      links: [
        {
          key: 'taxonomies',
          label: 'Taxonomies',
          to: { name: 'taxonomies' },
          active: pathActive('/taxonomies'),
          icon: 'taxonomy',
          dataTourId: 'nav-taxonomy',
        },
      ],
    });
  }

  // Structure — visible to admin + super_admin. The super-admin-only items
  // (Content Types / Pages / Menus / Redirects) appear only for super_admin;
  // a plain admin sees just Theme Settings here. Keeps nav aligned with the
  // route guards + API (Theme Settings = requiresAdmin; the rest =
  // requiresSuperAdmin) so the menu never shows what the API would block.
  if (auth.hasRole('admin')) {
    out.push({
      key: 'structure',
      title: 'Structure',
      links: [
        ...(auth.isSuperAdmin
          ? [
              {
                key: 'content-types',
                label: 'Content Types',
                to: { name: 'content-types' },
                active: pathActive('/content-types'),
                icon: 'types',
                dataTourId: 'nav-structure',
              },
              {
                key: 'pages',
                label: 'Pages',
                to: { name: 'pages' },
                active: pathActive('/pages'),
                icon: 'file',
              },
              {
                key: 'menus',
                label: 'Menus',
                to: { name: 'menus' },
                active: pathActive('/menus'),
                icon: 'menus',
              },
              {
                key: 'redirects',
                label: 'Redirects',
                to: { name: 'redirects' },
                active: pathActive('/redirects'),
                icon: 'redirects',
              },
            ]
          : []),
        {
          key: 'theme-settings',
          label: 'Theme Settings',
          to: { name: 'theme-settings' },
          active: pathActive('/theme-settings'),
          icon: 'types',
        },
        {
          key: 'block-gallery',
          label: 'Block Gallery',
          to: { name: 'block-gallery' },
          active: pathActive('/block-gallery'),
          icon: 'grid',
        },
      ],
    });
  }

  if (auth.isSuperAdmin) {
    out.push({
      key: 'settings',
      title: 'Settings',
      links: [
        {
          key: 'settings-site',
          label: 'Site Settings',
          to: { name: 'settings-site' },
          active: pathActive('/settings/site'),
          icon: 'settings',
          dataTourId: 'nav-settings',
        },
        {
          key: 'settings-email',
          label: 'Email',
          to: { name: 'settings-email' },
          active: pathActive('/settings/email'),
          icon: 'envelope',
        },
        {
          key: 'settings-infrastructure',
          label: 'Infrastructure',
          to: { name: 'settings-infrastructure' },
          active: pathActive('/settings/infrastructure'),
          icon: 'infrastructure',
        },
        {
          key: 'settings-users',
          label: 'Users & Roles',
          to: { name: 'settings-users' },
          active: pathActive('/settings/users'),
          icon: 'users',
        },
        {
          key: 'settings-api-keys',
          label: 'API Keys',
          to: { name: 'settings-api-keys' },
          active: pathActive('/settings/api-keys'),
          icon: 'key',
        },
        {
          key: 'settings-webhooks',
          label: 'Webhooks',
          to: { name: 'settings-webhooks' },
          active: pathActive('/settings/webhooks'),
          icon: 'webhook',
        },
      ],
    });
  }

  // Tools — maintenance actions, super_admin only (matches the Settings gating
  // above and the route guard on tools/*). Purge Cache is the first tool.
  if (auth.isSuperAdmin) {
    out.push({
      key: 'tools',
      title: 'Tools',
      links: [
        {
          key: 'tools-purge-cache',
          label: 'Purge Cache',
          to: { name: 'tools-purge-cache' },
          active: pathActive('/tools/purge-cache'),
          icon: 'refresh',
        },
      ],
    });
  }

  // Insights sits last on purpose — low-traffic observability pages
  // (Activity today; future: audit detail, reports, queue/job status)
  // shouldn't compete with primary destinations for the eye. Visible to
  // anyone authenticated since the same data already powers the
  // dashboard's Recent Activity widget, which has no role gate either.
  const insightsLinks: NavLink[] = [
    {
      key: 'activity',
      label: 'Activity',
      to: { name: 'activity' },
      active: pathActive('/activity'),
      icon: 'list',
      dataTourId: 'nav-insights',
    },
    {
      key: 'documentation',
      label: 'Documentation',
      to: { name: 'documentation' },
      active: pathActive('/documentation'),
      icon: 'docs',
    },
  ];
  // Bull Board lives at /api/admin/queues — server-rendered by the API, not
  // a Vue route. Gate to super_admin (matches the route's role check) and
  // render as an external link so RouterLink doesn't try to route to it.
  // API Docs Generator sits next to it: another super-admin-only developer
  // surface, but it IS a Vue route.
  if (auth.isSuperAdmin) {
    insightsLinks.push({
      key: 'queues',
      label: 'Background Jobs',
      href: '/api/admin/queues',
      active: false,
      icon: 'queue',
    });
    insightsLinks.push({
      key: 'api-docs',
      label: 'API Docs Generator',
      to: { name: 'api-docs' },
      active: pathActive('/api-docs'),
      icon: 'docs',
    });
  }
  out.push({
    key: 'insights',
    title: 'Insights',
    links: insightsLinks,
  });

  return out;
});

// ── Breadcrumb: brand / current page ──
const ROUTE_LABELS: Record<string, string> = {
  home: 'Dashboard',
  documentation: 'Documentation',
  content: 'All Content',
  'content-edit': 'Edit Content',
  media: 'Media Library',
  menus: 'Menus',
  'menu-edit': 'Edit Menu',
  pages: 'Pages',
  'page-edit': 'Edit Page',
  redirects: 'Redirects',
  'content-types': 'Content Types',
  'content-type-new': 'New Content Type',
  'content-type-edit': 'Edit Content Type',
  'settings-site': 'Site Settings',
  'settings-email': 'Email',
  'settings-infrastructure': 'Infrastructure',
  'settings-users': 'Users & Roles',
  'settings-api-keys': 'API Keys',
  'settings-webhooks': 'Webhooks',
  'tools-purge-cache': 'Purge Cache',
  taxonomies: 'Taxonomies',
  'taxonomy-terms': 'Terms',
  'api-docs': 'API Docs Generator',
};

const crumb = computed(() => {
  const name = typeof route.name === 'string' ? route.name : '';
  return ROUTE_LABELS[name] ?? BRAND;
});

// ── Topbar search → content list ──
const searchQ = ref('');
function onSearch(): void {
  const q = searchQ.value.trim();
  void router.push({ name: 'content', query: q ? { q } : {} });
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-mark" aria-hidden="true">◆</span>
        <span class="logo-meta">
          <span class="logo-text">{{ BRAND }}</span>
          <span class="logo-sub">Headless CMS</span>
        </span>
      </div>

      <nav class="sidebar-nav">
        <template v-for="section in sections" :key="section.key">
          <div v-if="section.title" class="nav-section-label">
            {{ section.title }}
          </div>
          <template v-for="link in section.links" :key="link.key">
            <!-- NAV_ICONS is a dev-controlled, static map of inline SVG path markup. -->
            <!-- eslint-disable vue/no-v-html -->
            <RouterLink
              v-if="link.to"
              :to="link.to"
              :data-tour-id="link.dataTourId"
              :class="['nav-item', { 'nav-item--active': link.active }]"
            >
              <svg
                class="nav-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                v-html="NAV_ICONS[link.icon] ?? NAV_ICONS['dot']"
              ></svg>
              <span class="nav-label">{{ link.label }}</span>
            </RouterLink>
            <a
              v-else-if="link.href"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              :class="['nav-item', { 'nav-item--active': link.active }]"
            >
              <svg
                class="nav-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                v-html="NAV_ICONS[link.icon] ?? NAV_ICONS['dot']"
              ></svg>
              <span class="nav-label">{{ link.label }}</span>
            </a>
            <!-- eslint-enable vue/no-v-html -->
          </template>
        </template>
      </nav>

      <div v-if="auth.user" class="sidebar-footer">
        <div class="user-chip">
          <span class="user-avatar" aria-hidden="true">{{ userInitial }}</span>
          <span class="user-meta">
            <span class="user-name">{{ auth.user.displayName }}</span>
            <span class="user-role">{{ auth.user.role }}</span>
          </span>
          <button
            type="button"
            class="logout-btn"
            title="Sign out"
            aria-label="Sign out"
            @click="onLogout"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <span class="breadcrumb-root">{{ BRAND }}</span>
          <span class="breadcrumb-sep" aria-hidden="true">/</span>
          <span class="breadcrumb-current">{{ crumb }}</span>
        </nav>

        <form class="topbar-search" role="search" @submit.prevent="onSearch">
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            v-model="searchQ"
            type="search"
            placeholder="Search content…"
            aria-label="Search content"
          />
        </form>

        <a
          v-if="auth.publicWebUrl"
          :href="auth.publicWebUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="view-site-link"
          title="Open the public website in a new tab"
        >
          <Icon name="external" />
          <span>View Site</span>
        </a>

        <button
          type="button"
          class="theme-toggle"
          :title="`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`"
          :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`"
          @click="toggleTheme"
        >
          <Icon :name="theme === 'dark' ? 'sun' : 'moon'" />
        </button>

        <button
          type="button"
          class="help-toggle"
          title="What is this page? (open help)"
          aria-label="Open help for this page"
          @click="help.toggle()"
        >
          <Icon name="help" />
        </button>
      </header>

      <main class="content-area">
        <UpdateBanner />
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-w) 1fr;
  height: 100%;
}

/* ── Sidebar ── */
.sidebar {
  background: var(--sb-bg);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  /* The sidebar itself never scrolls — the nav list in the middle does, so the
     logo (top) and the user chip (bottom) stay pinned in view. */
  overflow: hidden;
}

.sidebar-logo {
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--sb-border);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.logo-mark {
  width: 32px;
  height: 32px;
  background: var(--accent-gradient);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #fff;
  flex-shrink: 0;
}
.logo-meta {
  display: flex;
  flex-direction: column;
}
.logo-text {
  color: #fff;
  font-weight: 600;
  font-size: 15px;
}
.logo-sub {
  color: var(--sb-text);
  font-size: 11px;
  margin-top: 1px;
}

.sidebar-nav {
  padding: 12px 0;
  flex: 1;
  /* min-height:0 lets this flex child shrink below its content height so
     overflow-y can scroll it, instead of the list pushing the footer off the
     bottom of the screen. */
  min-height: 0;
  overflow-y: auto;
  /* Thin, subtle scrollbar so it's clear there's more nav to reach. */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
}
.sidebar-nav::-webkit-scrollbar {
  width: 8px;
}
.sidebar-nav::-webkit-scrollbar-track {
  background: transparent;
}
.sidebar-nav::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 4px;
}
.sidebar-nav::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.32);
}

.nav-section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sb-section);
  padding: 12px 20px 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 20px;
  color: var(--sb-text);
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 500;
  position: relative;
}
.nav-item:hover {
  color: var(--sb-text-hover);
  background: rgba(255, 255, 255, 0.04);
}
.nav-item--active {
  color: var(--sb-active-text);
  background: var(--sb-active-bg);
}
.nav-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent-gradient);
  border-radius: 0 2px 2px 0;
}
.nav-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.7;
}
.nav-item--active .nav-icon {
  opacity: 1;
}
.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--sb-border);
  flex-shrink: 0;
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
}
.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  color: var(--accent-contrast);
  flex-shrink: 0;
}
.user-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
  flex: 1;
}
.user-name {
  color: #e6edf3;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-role {
  color: var(--sb-text);
  font-size: 11px;
  text-transform: capitalize;
}
.logout-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: none;
  color: var(--sb-text);
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.15s,
    color 0.15s;
}
.logout-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

/* ── Main column ── */
.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  height: var(--topbar-h);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 16px;
  flex-shrink: 0;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}
.breadcrumb-sep {
  color: var(--text-tertiary);
}
.breadcrumb-current {
  color: var(--fg);
  font-weight: 500;
}

.topbar-search {
  margin-left: auto;
  display: flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 12px;
  gap: 8px;
  width: 240px;
  color: var(--text-tertiary);
}
.topbar-search:focus-within {
  border-color: var(--accent);
}
.topbar-search input {
  border: none;
  background: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--fg);
  outline: none;
  width: 100%;
}
.topbar-search input::placeholder {
  color: var(--text-tertiary);
}

.theme-toggle,
.help-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.theme-toggle:hover,
.help-toggle:hover {
  background: var(--bg);
  color: var(--fg);
  border-color: var(--accent);
}

.view-site-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  flex-shrink: 0;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.view-site-link:hover {
  background: var(--bg);
  color: var(--fg);
  border-color: var(--accent);
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: var(--bg);
}
</style>
