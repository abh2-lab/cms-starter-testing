import {
  defineEventHandler,
  getRequestURL,
  sendRedirect,
} from 'h3';

// Resolve admin-managed redirects from /api/public/redirects/resolve.
//
// Issued reasons / scope:
//   - The five seeded static pages migrated to /page/:slug need legacy-URL
//     handling: /about → /page/about, /contact → /page/contact, etc.
//   - Slug changes on a published page auto-create a row in the redirects
//     table (admin/pages.ts), so editors get free 301s when they rename.
//   - The /api/admin/redirects UI lets editors add ad-hoc rules.
//
// Strategy: ask the API only for paths that look like they could be
// legacy / admin-managed routes — skip anything that's plainly a Nuxt
// asset path or an API call. Nuxt's own router handles unknown routes by
// throwing 404 inside the [slug].vue / catch-all paths, so a non-match here
// flows through and the user lands on the regular 404 page.
//
// Performance: the API call only fires for unknown paths AND only after we've
// excluded the always-skip prefixes. The resolve endpoint reads from a single
// indexed (tenant, from_path) lookup and returns in <5ms locally. Cache
// elsewhere if this ever shows up in p99 (an LRU on `path → row|miss` would
// kill it dead).

// Paths that should NEVER hit the redirect lookup — either Nuxt-owned or
// API proxy paths. Anything else falls through to the API.
const SKIP_PREFIXES: readonly string[] = [
  '/api/',
  '/_nuxt/',
  '/__nuxt',
  '/_ipx/',
  '/_payload',
  '/article/',
  '/stories',
  '/search',
  '/favicon',
];

// File extensions for static assets bundled into apps/web/public — always
// skip these so a missing image doesn't fan out to the redirects API.
const STATIC_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|map|txt|xml|json|woff2?)$/i;

interface ResolveResponse {
  data: { toPath: string; redirectType: number };
}

export default defineEventHandler(async (event) => {
  // Only act on GET / HEAD — POSTs / PUTs / etc. should never be redirected
  // (the body would be lost on the 301 hop).
  const method = event.method;
  if (method !== 'GET' && method !== 'HEAD') return;

  const url = getRequestURL(event);
  const path = url.pathname;
  if (path === '/' || path === '') return;
  if (STATIC_EXT_RE.test(path)) return;
  for (const prefix of SKIP_PREFIXES) {
    if (path === prefix.replace(/\/$/, '') || path.startsWith(prefix)) return;
  }

  // The API is reached same-origin via the Nitro proxy route rule
  // ('/api/public/**' → NUXT_API_PROXY_TARGET). $fetch resolves the URL
  // against the current request's origin in SSR, so we hit the proxy and
  // then the API in one hop with no extra base-URL config.
  try {
    const res = await $fetch<ResolveResponse>(
      `/api/public/redirects/resolve`,
      { query: { path } },
    );
    if (res?.data?.toPath) {
      await sendRedirect(
        event,
        res.data.toPath,
        res.data.redirectType === 302 ? 302 : 301,
      );
    }
  } catch (err) {
    // 404 is the expected "no redirect for this path" case — fall through
    // to let Nuxt's router answer (which may itself 404 with the regular
    // error page). Anything else (timeout, 5xx) we log and fall through
    // too: the redirect feature must never wedge the site.
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status !== 404) {
      console.warn('[redirects] resolve failed:', status, path);
    }
  }
});
