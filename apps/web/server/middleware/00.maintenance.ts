import {
  defineEventHandler,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
} from 'h3';

// Public-site maintenance gate.
//
// When the admin flips `maintenanceMode` on in Site Settings (or via the
// dashboard quick-toggle), this middleware short-circuits every visitor-
// facing request with a 503 and a minimal HTML maintenance page. The admin
// app runs on its own host so editors keep working through the outage; the
// admin still needs the public API to be up to flip the flag back off.
//
// Fail-open contract (non-negotiable):
//   On ANY error fetching /api/public/site-settings (API down, timeout,
//   non-2xx, malformed JSON) we treat it as maintenanceMode=false and let
//   the request pass through. The public site must NEVER 503 because the
//   admin API crashed — that turns one outage into two. We log fail-open
//   events at most once per minute so a sustained API outage doesn't spam
//   the logs.
//
// Filename starts with `00.` so this runs BEFORE redirects.ts: there's no
// value in resolving a legacy redirect when we're about to send a 503.

const SKIP_PREFIXES: readonly string[] = [
  '/api/',
  '/_nuxt/',
  '/__nuxt',
  '/_ipx/',
  '/_payload',
  '/favicon',
];

const STATIC_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|map|txt|xml|json|woff2?)$/i;

interface SiteSettingsResponse {
  data: { maintenanceMode?: boolean } | null;
}

// One-warning-per-minute throttle so a long API outage doesn't fill the
// logs. Module-scope timestamp; resets when the process restarts.
let lastFailOpenWarnAt = 0;
function warnThrottled(message: string, err: unknown): void {
  const now = Date.now();
  if (now - lastFailOpenWarnAt < 60_000) return;
  lastFailOpenWarnAt = now;
  console.warn(message, err);
}

const MAINTENANCE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>We'll be back shortly</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    display: grid; place-items: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f7f7f8; color: #1a1a1a;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1115; color: #e6e6e6; }
  }
  main { max-width: 480px; padding: 32px; text-align: center; }
  h1 { font-size: 28px; margin: 0 0 12px; font-weight: 600; }
  p { font-size: 16px; line-height: 1.5; opacity: 0.8; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>We'll be back shortly</h1>
  <p>The site is undergoing scheduled maintenance. Please check back in a few minutes.</p>
</main>
</body>
</html>`;

export default defineEventHandler(async (event) => {
  const method = event.method;
  if (method !== 'GET' && method !== 'HEAD') return;

  const url = getRequestURL(event);
  const path = url.pathname;
  if (STATIC_EXT_RE.test(path)) return;
  for (const prefix of SKIP_PREFIXES) {
    if (path === prefix.replace(/\/$/, '') || path.startsWith(prefix)) return;
  }

  let maintenance: boolean;
  try {
    const res = await $fetch<SiteSettingsResponse>('/api/public/site-settings', {
      timeout: 2000,
    });
    maintenance = res?.data?.maintenanceMode === true;
  } catch (err) {
    // Fail open: API unreachable → show the site. Never block on this.
    warnThrottled('[maintenance] site-settings fetch failed; failing open:', err);
    return;
  }

  if (!maintenance) return;

  setResponseStatus(event, 503);
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8');
  setResponseHeader(event, 'Retry-After', 300);
  setResponseHeader(event, 'Cache-Control', 'no-store');
  return MAINTENANCE_HTML;
});
