// Defense-in-depth Content-Security-Policy for ordinary public pages — i.e.
// everything that is NOT an admin-framed preview (those get only a
// frame-ancestors allowance; see 01.security-headers.ts). Kept in its own
// h3/Nitro-free module so the policy string is a pure value the test suite can
// import and pin without pulling the server runtime (embed-csp.test.ts).
//
// Deliberately a PARTIAL policy: it sets only frame/script directives plus a few
// cheap hardening ones and NO default-src, so every resource type we don't name
// (style, font, img, connect, media) stays unrestricted — the Google Fonts CSS +
// files, the remote OG-card images useEmbeds injects, and the same-origin
// /api/embed/card fetch all keep working with zero allow-listing.
//
//   • frame-src https:  — admits every embed iframe (the link-provider registry,
//     paste-your-own-code "iframe mode", AND Raw-mode static pages all emit https
//     iframes) while still blocking data:/blob:/http: frame injection. Host-level
//     allow-listing is intentionally NOT used here: it would break the two
//     "paste any https iframe" features.
//   • script-src        — 'self' for Nuxt's own bundles, 'unsafe-inline' for its
//     SSR hydration (there is no nonce pipeline in this hand-rolled setup), and
//     the social widget loaders. A <script src> from any OTHER origin (an
//     injected skimmer) is blocked.
//   • object-src 'none', base-uri 'self', frame-ancestors 'self' — close the
//     plugin, <base>-hijack, and clickjacking holes for free.
//
// The script-src host list mirrors EMBED_SCRIPT_HOSTS in the theme's embed
// provider registry (themes/default/app/utils/embed-providers.ts);
// embed-csp.test.ts fails if they drift. It is duplicated here as a local
// literal rather than imported so this Nitro-side module stays free of the theme
// layer — the same self-contained boundary the middleware and card.get.ts keep.
const EMBED_SCRIPT_SRC_HOSTS = [
  'https://platform.twitter.com',
  'https://syndication.twitter.com',
  'https://cdn.syndication.twimg.com',
  'https://www.instagram.com',
  'https://www.tiktok.com',
];

export const PUBLIC_PAGE_CSP = [
  'frame-src https:',
  `script-src 'self' 'unsafe-inline' ${EMBED_SCRIPT_SRC_HOSTS.join(' ')}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');
