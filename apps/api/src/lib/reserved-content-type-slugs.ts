// Slugs that would collide with first-class entity concepts in this CMS.
// Pages, media, tenants, users, settings, taxonomies and terms are all
// modelled as their own tables / admin sections — not as content types.
// Registering a content_type with one of these slugs misleads editors:
// the admin shows a third "Page" card next to Article/Author, but the
// real /pages screen reads from a different table entirely. Reject at
// the admin write layer AND the fixture loader so the mistake can't
// be reintroduced from either path.
//
// Keep this list separate from `reserved-slugs.ts` — that file is about
// content-page slugs shadowing public Nuxt routes; this one is about
// content-type slugs shadowing first-class entities.
export const RESERVED_CONTENT_TYPE_SLUGS = [
  'page',         // pages live in `pages` table, not `content`
  'pages',
  'media',        // media live in `media` table
  'tenant',       // tenants live in `tenants` table
  'tenants',
  'user',         // admin users live in `admin_users` table
  'users',
  'admin',
  'setting',      // settings live in `*_settings` tables
  'settings',
  'taxonomy',     // taxonomies live in `taxonomies` table
  'taxonomies',
  'term',         // taxonomy terms live in `taxonomy_terms` table
  'terms',
  'menu',         // menus live in `menus` table
  'menus',
  'redirect',     // redirects live in `redirects` table
  'redirects',
  'webhook',      // webhooks live in `webhooks` table
  'webhooks',
  'api-key',      // api keys live in `api_keys` table
  'api-keys',
  'template',     // page templates live in `page_templates` table
  'templates',
] as const;

export function isReservedContentTypeSlug(slug: string): boolean {
  return (RESERVED_CONTENT_TYPE_SLUGS as readonly string[]).includes(slug);
}
