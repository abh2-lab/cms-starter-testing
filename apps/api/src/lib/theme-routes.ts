// A read-only manifest of the public site's CODE-defined routes — the URLs the
// active theme serves from Nuxt page files rather than from `pages` table rows.
//
// The admin's Pages screen renders these in a separate, read-only "Theme &
// system routes" section so editors can SEE every URL the site serves (open it,
// or find where its content is managed) even though they aren't editable pages.
//
// Keep in sync with the theme's route files (apps/web/themes/default/app/pages/)
// and with reserved-slugs.ts (which blocks page creation on the singleton
// slugs). Page-backed slugs (e.g. "/", "/contact") intentionally live as real
// `pages` rows and are NOT listed here, to avoid duplicating the table above.

export type ThemeRouteKind = 'singleton' | 'template';
export type ThemeRouteDriver = 'Content' | 'Taxonomies' | 'App';

export interface ThemeRoute {
  /** URL or URL pattern, e.g. "/stories" or "/:category/:article". */
  path: string;
  /** Human label for the admin list. */
  label: string;
  /** One-line description of what it renders. */
  description: string;
  /** singleton = one fixed URL (viewable); template = one per record. */
  kind: ThemeRouteKind;
  /** What supplies the data behind it. */
  drivenBy: ThemeRouteDriver;
  /** For singletons, the concrete public path to open. Null for per-record
   *  templates — they have no single canonical URL. */
  viewPath: string | null;
  /** Where an editor manages the content behind this route. `routeName` is an
   *  admin route name. Null for pure app behavior (e.g. search). */
  manage: { label: string; routeName: string } | null;
}

export const THEME_ROUTES: ThemeRoute[] = [
  {
    path: '/stories',
    label: 'Stories archive',
    description: 'Paginated list of published articles (also served at /news).',
    kind: 'singleton',
    drivenBy: 'Content',
    viewPath: '/stories',
    manage: { label: 'Manage in Content', routeName: 'content' },
  },
  {
    path: '/authors',
    label: 'Authors index',
    description: 'Directory of every author who has published.',
    kind: 'singleton',
    drivenBy: 'Content',
    viewPath: '/authors',
    manage: { label: 'Manage in Content', routeName: 'content' },
  },
  {
    path: '/search',
    label: 'Search',
    description: 'Full-text search results page.',
    kind: 'singleton',
    drivenBy: 'App',
    viewPath: '/search',
    manage: null,
  },
  {
    path: '/:category/:article',
    label: 'Article',
    description: 'The single-article page — one URL per published article.',
    kind: 'template',
    drivenBy: 'Content',
    viewPath: null,
    manage: { label: 'Manage in Content', routeName: 'content' },
  },
  {
    path: '/author/:slug',
    label: 'Author profile',
    description: "A single author's profile and their stories.",
    kind: 'template',
    drivenBy: 'Content',
    viewPath: null,
    manage: { label: 'Manage in Content', routeName: 'content' },
  },
  {
    path: '/:category',
    label: 'Category & tag archives',
    description: 'Archive listing for a taxonomy term — one URL per category/tag.',
    kind: 'template',
    drivenBy: 'Taxonomies',
    viewPath: null,
    manage: { label: 'Manage in Taxonomies', routeName: 'taxonomies' },
  },
];
