import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseHeader,
} from 'h3';
import { PUBLIC_PAGE_CSP } from '../utils/public-page-csp';

// Production security headers — moved out of nuxt.config routeRules (theme
// engine v2.0) because the frame guard must vary per request: the admin
// embeds the public site in iframes on the ADMIN origin (the structure
// editor's live preview, the Block Gallery's per-block previews, and the
// dynamic PAGE editor's live preview), and a static `X-Frame-Options:
// SAMEORIGIN` would block them. When an admin origin is configured
// (NUXT_ADMIN_ORIGIN) AND the request is framable by the admin — a shape-valid
// preview token in EITHER the `theme_preview` (structure editor) or `preview`
// (page/content editor) query param, OR a /preview/* editor-utility route —
// the guard switches to `Content-Security-Policy: frame-ancestors
// <admin-origin>`; every other request keeps the exact pre-v2.0 header set.
//
// The two token params exist because the two editors build their preview URL
// differently: the structure editor appends `?theme_preview=<token>` (theme.ts),
// the page editor appends `?preview=<token>` (admin/pages.ts). They share one
// wire format (base64url.base64url), so one shape check covers both — and the
// page editor's iframe was blank in production until this param was added here.
//
// Shape-only token check on purpose: the web app does not (and must not) hold
// the HMAC secret — the API verifies it before serving draft data. The worst
// this can be wrong about is letting the ADMIN origin frame a normal public
// page or a noindex /preview/* utility, which is harmless.
//
// Dev parity: the old routeRules block was production-only (no headers in
// dev), so this middleware no-ops outside production too.

const TOKEN_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Warn ONCE (not per request) when a production deploy is missing the admin
// origin — otherwise the admin's iframe previews (structure editor live
// preview, Block Gallery) silently render blank with no diagnostic.
let warnedMissingAdminOrigin = false;

export default defineEventHandler((event) => {
  if (process.env.NODE_ENV !== 'production') return;

  if (!warnedMissingAdminOrigin && !process.env['NUXT_ADMIN_ORIGIN']) {
    warnedMissingAdminOrigin = true;
    console.warn(
      '[security-headers] NUXT_ADMIN_ORIGIN is unset — the admin cannot iframe ' +
        'the public site (structure editor preview + Block Gallery will be blank). ' +
        'Set it to the admin origin, e.g. https://admin.example.com.',
    );
  }

  setResponseHeader(
    event,
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload',
  );
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin');

  // Structure editor sends `theme_preview`; page/content editor sends `preview`.
  // Either token, when shape-valid, marks the request framable by the admin.
  const query = getQuery(event);
  const rawThemePreview = query['theme_preview'];
  const rawPreview = query['preview'];
  const tokenShaped =
    (typeof rawThemePreview === 'string' &&
      TOKEN_SHAPE_RE.test(rawThemePreview)) ||
    (typeof rawPreview === 'string' && TOKEN_SHAPE_RE.test(rawPreview));
  // The /preview/* routes (block + part previews) are noindex editor utilities
  // meant to be iframed by the admin.
  const isPreviewRoute = getRequestURL(event).pathname.startsWith('/preview/');
  // Plain env read (set NUXT_ADMIN_ORIGIN on the web container, e.g.
  // https://admin.example.com). Same value at boot either way; skipping
  // useRuntimeConfig keeps this file free of Nuxt's #imports alias, which
  // ESLint's project service can't resolve for server middleware.
  const adminOrigin = process.env['NUXT_ADMIN_ORIGIN'];

  if (
    (tokenShaped || isPreviewRoute) &&
    typeof adminOrigin === 'string' &&
    adminOrigin.length > 0
  ) {
    setResponseHeader(
      event,
      'Content-Security-Policy',
      `frame-ancestors ${adminOrigin}`,
    );
    return;
  }
  setResponseHeader(event, 'X-Frame-Options', 'SAMEORIGIN');
  setResponseHeader(event, 'Content-Security-Policy', PUBLIC_PAGE_CSP);
});
