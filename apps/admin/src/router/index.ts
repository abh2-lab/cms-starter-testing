import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import { useAuthStore } from '@/stores/auth';

// Module-scope flag set by main.ts after probing /admin/setup/status. When
// true, every non-/setup route is redirected to /setup so the wizard runs
// before anything else. Bootstrap completion flips this back to false via
// setSetupStatus(false) so the user can proceed to /.
let needsSetup = false;
export function setSetupStatus(value: boolean): void {
  needsSetup = value;
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('@/pages/Home.vue'),
      },
      {
        path: 'content',
        name: 'content',
        component: () => import('@/pages/ContentList.vue'),
      },
      {
        // Legacy URL — the standalone "new content" form was replaced by the
        // type-picker modal on the list (+ editor new mode). Without this
        // record /content/new would fall through to /content/:id with
        // id='new' and 400 on load.
        path: 'content/new',
        redirect: { name: 'content', query: { create: '1' } },
      },
      {
        path: 'media',
        name: 'media',
        component: () => import('@/pages/Media.vue'),
      },
      {
        path: 'activity',
        name: 'activity',
        component: () => import('@/pages/Activity.vue'),
      },
      {
        // Developer-facing docs reader — renders bundled src/docs/*.md.
        // Visible to anyone authenticated (matches Activity); no API calls.
        path: 'documentation',
        name: 'documentation',
        component: () => import('@/pages/Documentation.vue'),
      },
      {
        path: 'api-docs',
        name: 'api-docs',
        component: () => import('@/pages/ApiDocsGenerator.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'menus',
        name: 'menus',
        component: () => import('@/pages/MenusList.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'pages',
        name: 'pages',
        component: () => import('@/pages/PagesList.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        // Theme Settings — the single home for theme-level config (Active
        // Theme, Templates & Parts, Page Templates, Routes). admin AND
        // super_admin per the v2.0 spec (requiresAdmin = rank ≥ admin),
        // unlike the super_admin-only entries around it. Replaces the old
        // standalone /structure "Templates & Parts" list.
        path: 'theme-settings',
        name: 'theme-settings',
        component: () => import('@/pages/ThemeSettings.vue'),
        meta: { requiresAdmin: true },
      },
      {
        // Block Gallery — visual catalogue of every theme block. admin AND
        // super_admin, same gate as Theme Settings.
        path: 'block-gallery',
        name: 'block-gallery',
        component: () => import('@/pages/BlockGallery.vue'),
        meta: { requiresAdmin: true },
      },
      {
        // Block-defaults editor — edit ONE block's default fields/options as a
        // site-wide override. Opened from the Block Gallery's Edit button.
        path: 'blocks/:key/edit',
        name: 'block-edit-default',
        component: () => import('@/pages/BlockDefaultsEditView.vue'),
        meta: { requiresAdmin: true },
      },
      {
        path: 'pages/new',
        name: 'pages-new',
        component: () => import('@/pages/PageNew.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        // Developer guide for the dynamic block system — reachable from a
        // "How to add blocks" button on the Pages listing. Static content;
        // no API calls.
        path: 'pages/help/blocks',
        name: 'pages-help-blocks',
        component: () => import('@/pages/DynamicBlocksGuide.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        // Static page editor lives INSIDE AppLayout — the admin sidebar
        // stays visible like every other content-style route. Dynamic
        // pages get a different URL (/pages/:id/build, top-level) because
        // the 3-column builder wants the full viewport. Each route's
        // page component redirects to the other if the loaded row's type
        // doesn't match — bookmarks survive a type change of the row.
        path: 'pages/:id',
        name: 'page-edit-static',
        component: () => import('@/pages/PageEditStatic.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'menus/:id',
        name: 'menu-edit',
        component: () => import('@/pages/MenuEditor.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'redirects',
        name: 'redirects',
        component: () => import('@/pages/Redirects.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'content-types',
        name: 'content-types',
        component: () => import('@/pages/ContentTypesList.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'settings/site',
        name: 'settings-site',
        component: () => import('@/pages/SiteSettings.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'settings/email',
        name: 'settings-email',
        component: () => import('@/pages/EmailSettings.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'settings/infrastructure',
        name: 'settings-infrastructure',
        component: () => import('@/pages/InfrastructureSettings.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'settings/users',
        name: 'settings-users',
        component: () => import('@/pages/Users.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'settings/api-keys',
        name: 'settings-api-keys',
        component: () => import('@/pages/ApiKeys.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'settings/webhooks',
        name: 'settings-webhooks',
        component: () => import('@/pages/Webhooks.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        // Tools → Purge Cache: on-demand cache clearing. super_admin only, like
        // the Settings pages it sits beside.
        path: 'tools/purge-cache',
        name: 'tools-purge-cache',
        component: () => import('@/pages/PurgeCache.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'content-types/new',
        name: 'content-type-new',
        component: () => import('@/pages/ContentTypeForm.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'content-types/:id',
        name: 'content-type-edit',
        component: () => import('@/pages/ContentTypeForm.vue'),
        meta: { requiresSuperAdmin: true },
      },
      {
        path: 'taxonomies',
        name: 'taxonomies',
        component: () => import('@/pages/TaxonomiesList.vue'),
      },
      {
        path: 'taxonomies/:id',
        name: 'taxonomy-terms',
        component: () => import('@/pages/TaxonomyTerms.vue'),
      },
    ],
  },
  {
    // New-post mode of the full-screen editor: no row exists yet — the first
    // save POSTs and the route swaps to content-edit. Same component, so the
    // instance is reused across that swap (no remount).
    path: '/content/new/:typeId',
    name: 'content-create',
    component: () => import('@/pages/ContentEdit.vue'),
    meta: { requiresAuth: true },
  },
  {
    // Standalone full-screen editor — intentionally NOT under AppLayout so it
    // gets the whole viewport (no shell sidebar/topbar). "All Content" links
    // back to /content, which renders inside the shell.
    path: '/content/:id',
    name: 'content-edit',
    component: () => import('@/pages/ContentEdit.vue'),
    meta: { requiresAuth: true },
  },
  {
    // Dynamic page builder — full-screen, outside AppLayout. The 3-column
    // builder consumes the whole viewport; the admin sidebar would just
    // compete for horizontal space. Static pages have their own URL at
    // /pages/:id which is nested inside AppLayout (see above).
    path: '/pages/:id/build',
    name: 'page-edit-dynamic',
    component: () => import('@/pages/PageBuildView.vue'),
    meta: { requiresAuth: true, requiresSuperAdmin: true },
  },
  {
    // Structure editor — full-screen, outside AppLayout, same reasoning as
    // the dynamic page builder: the unified editor consumes the whole viewport.
    path: '/structure/:key',
    name: 'structure-edit',
    component: () => import('@/pages/StructureEditView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/Login.vue'),
    meta: { guestOnly: true },
  },
  {
    // First-run setup wizard. Visible only when the API reports needsSetup;
    // any other state redirects to /login. See setSetupStatus().
    path: '/setup',
    name: 'setup',
    component: () => import('@/pages/Setup.vue'),
    meta: { setupOnly: true },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  // First-boot redirect takes precedence over every other guard: until the
  // initial super_admin exists, nothing else in the app is reachable.
  if (needsSetup && to.name !== 'setup') {
    return { name: 'setup' };
  }
  if (!needsSetup && to.meta['setupOnly']) {
    return { name: auth.isAuthenticated ? 'home' : 'login' };
  }
  if (to.meta['requiresAuth'] && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta['guestOnly'] && auth.isAuthenticated) {
    return { name: 'home' };
  }
  if (to.meta['requiresSuperAdmin'] && !auth.isSuperAdmin) {
    return { name: 'home' };
  }
  // rank ≥ admin (admin + super_admin) — the theme structure editor's gate.
  if (to.meta['requiresAdmin'] && !auth.hasRole('admin')) {
    return { name: 'home' };
  }
  return true;
});
