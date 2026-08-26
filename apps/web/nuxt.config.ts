import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

// Load the MONOREPO ROOT .env into process.env for anything not already set.
//
// Nuxt reads a .env from its own project root (apps/web/), but this repo keeps
// one .env at the monorepo root — api and worker reach it explicitly with
// `tsx --env-file=../../.env`, and nuxt has no equivalent. So ACTIVE_THEME and
// friends never arrived here, which went unnoticed only while the theme
// fallback happened to be the same value the .env would have supplied.
//
// Existing process.env wins, so `ACTIVE_THEME=basic pnpm dev` and `PORT=3002`
// still override the file.
function loadRootEnv(): void {
  const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
  if (!existsSync(rootEnv)) return;
  for (const rawLine of readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadRootEnv();
// Neutral default Nuxt frontend for the CMS test stack.
// (static assets served from /public — e.g. /images/video-thumbnail-home.jpeg)
//
// The public API is reached SAME-ORIGIN via a Nitro proxy (see routeRules
// below): the browser and SSR both call `/api/public/*` on this site's own
// origin and Nitro forwards to the API. No CORS, no public API URL to wire
// up — mirrors how the admin's nginx proxies /api. The proxy target is baked
// at build time: the Docker image sets NUXT_API_PROXY_TARGET=http://api:3000
// (compose service name), and non-Docker `pnpm dev` falls back to
// http://127.0.0.1:3000 (not "localhost") so Windows installs don't try ::1
// first — the API binds to 127.0.0.1 only, and a missed proxy lands every
// /api/public/* call on Vite's HMR socket, which returns 426 for any plain
// HTTP request and looks like the entire public site is broken.
const apiProxyTarget =
  process.env['NUXT_API_PROXY_TARGET'] || 'http://127.0.0.1:3000';

const isProd = process.env['NODE_ENV'] === 'production';

// The active theme layer is chosen by ACTIVE_THEME (same env @cms/config reads
// for the block palette).
//
// The CMS ships two themes:
//   'default' — the GENERIC CORE layer: pages, the data layer, the block
//               resolver, and the 39 core renderers. Part of the CMS, and it
//               receives updates.
//   'basic'   — the neutral starter, layered on default. Also part of the CMS.
//
// Anything else names a publisher's CUSTOM theme — a directory they build by
// hand under themes/, like 'ping' in this repo. Custom themes are the
// publisher's own work and never receive updates.
//
// Unset falls back to 'default', never to a custom theme: an exported starter
// contains only default and basic, so falling back to a custom name would
// point a fresh install at a layer that isn't there. This repo's .env sets
// ACTIVE_THEME=ping.
const requestedTheme = (process.env['ACTIVE_THEME'] || 'default').trim();
const themesDir = fileURLToPath(new URL('./themes', import.meta.url));
// Fall back rather than fail hard if the named theme is absent — a missing
// custom theme should degrade to the core look, not break the build.
const activeTheme = existsSync(join(themesDir, requestedTheme))
  ? requestedTheme
  : 'default';

export default defineNuxtConfig({
  // The active theme is a Nuxt layer. Everything visual (pages, components,
  // layouts, composables, utils, assets) plus the theme's CSS + fonts lives in
  // apps/web/themes/default; this host config keeps only infrastructure — the
  // API proxy, ISR routeRules, devServer — plus app.vue. Swapping the theme is
  // a matter of pointing this `extends` at a different layer.
  extends: [`./themes/${activeTheme}`],
  // Nuxt DevTools (the floating panel in dev) costs ~9s of setup time on every
  // `pnpm dev` boot and we don't use it. Must stay an explicit `false`: Nuxt
  // installs the module unless `devtools.enabled` is exactly false, so deleting
  // this line turns it back on rather than off.
  devtools: { enabled: false },
  devServer: {
    // API runs on :3000; web sits next to it. PORT wins when set so a second
    // dev instance (e.g. the Claude Preview verifier) can run beside the
    // primary `pnpm dev` one without fighting over 3001.
    port: Number(process.env['PORT'] || 3001),
  },
  app: {
    head: {
      // Generic document head. The brand <title> + fonts live in the theme
      // layer's config (apps/web/themes/default/nuxt.config.ts); Nuxt merges
      // app.head across layers.
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1.0, viewport-fit=cover',
        },
        {
          name: 'description',
          content:
            'A minimal neutral public site exercising every CMS feature end-to-end.',
        },
      ],
    },
  },
  // The structure editor's iframe preview (theme engine v2.0) needs the
  // frame guard to vary per request, so the production security headers
  // (formerly a static routeRules '/**' headers block here) moved to
  // server/middleware/01.security-headers.ts. NUXT_ADMIN_ORIGIN (read there)
  // feeds the frame-ancestors allowance for preview requests.
  //
  // ISR matches the API's 300s public cache TTL so the layers cache together.
  // Production only — in dev the SWR cache swallows admin edits for up to
  // 5 minutes and produces confusing hydration mismatches against fresh data.
  // /article/** intentionally NOT cached at the Nuxt layer: the API response
  // is already cached in DragonflyDB, and a Nuxt-side HTML cache would also
  // store ?preview= responses, leaking draft renders to public visitors who
  // hit the same slug after a preview warmed the cache. The theme_preview
  // paths (articles + category/tag pages) are likewise un-cached here, so a
  // draft render can never be stored server-side.
  routeRules: {
    '/api/public/**': { proxy: `${apiProxyTarget}/api/public/**` },
    ...(isProd
      ? {
          '/': { swr: 300 },
          '/archive': { swr: 300 },
          '/archive/**': { swr: 300 },
          '/stories': { swr: 300 },
          '/stories/**': { swr: 300 },
        }
      : {}),
  },
});
