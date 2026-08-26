// Slugs that would collide with first-class Nuxt routes on the public site
// (apps/web/app/pages/). A page with one of these slugs would be unreachable
// because Nuxt's named/static routes match before the root-level catch-all
// (apps/web/app/pages/[slug].vue). Reject create/rename into one of these
// at the admin write layer with a clear error so the admin notices.
//
// Keep this list in lockstep with apps/web/app/pages/. When a new top-level
// route lands there, add the segment here too.
export const RESERVED_SLUGS = [
  'article',  // apps/web/app/pages/article/[slug].vue
  'contact',  // apps/web/app/pages/contact.vue
  'search',   // apps/web/app/pages/search.vue
  'stories',  // apps/web/app/pages/stories/index.vue
  'news',     // alias of /stories via definePageMeta
  'preview',  // apps/web/app/pages/preview/...
  'page',     // legacy prefix — reserved so a tenant can't shadow the historic URL
  'api',      // Nitro proxy prefix
] as const;

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}
