// Canonical map of the admin's primary (sidebar) destinations.
//
// This is the single source the in-admin AI assistant reads to give accurate,
// ROLE-AWARE, step-by-step navigation ("open the Settings group in the sidebar
// -> click Email -> ..."). It mirrors the sidebar groups/role-gates defined in
// apps/admin/src/layouts/AppLayout.vue and the routes in
// apps/admin/src/router/index.ts.
//
// It is kept honest by drift tests (packages/admin-guide/src/destinations.test.ts
// + apps/admin/src/router/index.guard.test.ts): every routeName here must exist
// in the router AND have a help-content entry. So a new admin page cannot ship
// without being documented for the assistant — answering the "the map silently
// goes stale" risk structurally rather than by discipline.

export type AdminRole =
  | 'viewer'
  | 'author'
  | 'editor'
  | 'admin'
  | 'super_admin';

export interface AdminDestination {
  /** Vue Router route name. MUST equal the helpContent key for this page. */
  routeName: string;
  /** Sidebar label shown to the user. */
  label: string;
  /** Sidebar group heading, or null for the ungrouped top item (Dashboard). */
  group: string | null;
  /** Minimum role that can see/open this destination (matches the sidebar gate). */
  requiredRole: AdminRole;
  /** Canonical path with route params stripped. */
  path: string;
  /** One-line purpose — feeds the compact nav index injected into the prompt. */
  purpose: string;
  /** True for non-Vue-route surfaces (e.g. external dashboards). Excluded from
   *  the router-parity drift check. Unused today; reserved for things like the
   *  Bull Board queue UI at /api/admin/queues. */
  external?: boolean;
}

// Order roughly follows the sidebar top-to-bottom.
export const ADMIN_DESTINATIONS: AdminDestination[] = [
  {
    routeName: 'home',
    label: 'Dashboard',
    group: null,
    requiredRole: 'viewer',
    path: '/',
    purpose: 'Site overview: recently edited posts, team activity, and shortcuts.',
  },
  {
    routeName: 'content',
    label: 'All Content',
    group: 'Content',
    requiredRole: 'viewer',
    path: '/content',
    purpose: 'List, filter, search and open every article/post/page; start new content.',
  },
  {
    routeName: 'media',
    label: 'Media Library',
    group: 'Media',
    requiredRole: 'viewer',
    path: '/media',
    purpose: 'Upload, browse and manage images, video and files.',
  },
  {
    routeName: 'taxonomies',
    label: 'Taxonomies',
    group: 'Taxonomy',
    requiredRole: 'editor',
    path: '/taxonomies',
    purpose: 'Manage the categories and tags used to group content.',
  },
  {
    routeName: 'content-types',
    label: 'Content Types',
    group: 'Structure',
    requiredRole: 'super_admin',
    path: '/content-types',
    purpose: 'Define the shapes of content and the fields each type has.',
  },
  {
    routeName: 'pages',
    label: 'Pages',
    group: 'Structure',
    requiredRole: 'super_admin',
    path: '/pages',
    purpose: 'Manage standalone static and dynamic (block-built) pages.',
  },
  {
    routeName: 'menus',
    label: 'Menus',
    group: 'Structure',
    requiredRole: 'super_admin',
    path: '/menus',
    purpose: 'Build the navigation menus readers click (header, footer, etc.).',
  },
  {
    routeName: 'redirects',
    label: 'Redirects',
    group: 'Structure',
    requiredRole: 'super_admin',
    path: '/redirects',
    purpose: 'Manage the 301/302 URL redirects applied by the public site.',
  },
  {
    routeName: 'theme-settings',
    label: 'Theme Settings',
    group: 'Structure',
    requiredRole: 'admin',
    path: '/theme-settings',
    purpose: 'Active theme, templates and parts, page templates, and routes.',
  },
  {
    routeName: 'block-gallery',
    label: 'Block Gallery',
    group: 'Structure',
    requiredRole: 'admin',
    path: '/block-gallery',
    purpose: 'Browse every theme block and edit block defaults applied site-wide.',
  },
  {
    routeName: 'settings-site',
    label: 'Site Settings',
    group: 'Settings',
    requiredRole: 'super_admin',
    path: '/settings/site',
    purpose: 'Site name, description, social links and global options.',
  },
  {
    routeName: 'settings-email',
    label: 'Email',
    group: 'Settings',
    requiredRole: 'super_admin',
    path: '/settings/email',
    purpose: 'Configure the outgoing email (SMTP) provider.',
  },
  {
    routeName: 'settings-infrastructure',
    label: 'Infrastructure',
    group: 'Settings',
    requiredRole: 'super_admin',
    path: '/settings/infrastructure',
    purpose: 'Object storage, error monitoring, AI assistant and performance/limits.',
  },
  {
    routeName: 'settings-users',
    label: 'Users & Roles',
    group: 'Settings',
    requiredRole: 'super_admin',
    path: '/settings/users',
    purpose: 'Invite and manage users and set their roles.',
  },
  {
    routeName: 'settings-api-keys',
    label: 'API Keys',
    group: 'Settings',
    requiredRole: 'super_admin',
    path: '/settings/api-keys',
    purpose: 'Create and revoke API keys for the public/admin API.',
  },
  {
    routeName: 'settings-webhooks',
    label: 'Webhooks',
    group: 'Settings',
    requiredRole: 'super_admin',
    path: '/settings/webhooks',
    purpose: 'Register outbound webhooks for content and system events.',
  },
  {
    routeName: 'activity',
    label: 'Activity',
    group: 'Insights',
    requiredRole: 'viewer',
    path: '/activity',
    purpose: 'Audit log of recent actions across the CMS.',
  },
  {
    routeName: 'documentation',
    label: 'Documentation',
    group: 'Insights',
    requiredRole: 'viewer',
    path: '/documentation',
    purpose: 'Developer/theme-author guides (blocks, templates, theme engine).',
  },
  {
    routeName: 'api-docs',
    label: 'API Docs Generator',
    group: 'Insights',
    requiredRole: 'super_admin',
    path: '/api-docs',
    purpose: 'Generate API reference docs from the live schema.',
  },
];

export const DESTINATIONS_BY_ROUTE: Map<string, AdminDestination> = new Map(
  ADMIN_DESTINATIONS.map((d) => [d.routeName, d]),
);
