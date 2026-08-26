import { apiFetch } from '@/lib/api';

// Mirrors the discriminated union the API's PurgeBodySchema accepts
// (apps/api/src/routes/admin/cache.ts): clear everything, clear one content
// type by slug, or clear only the website page cache.
export type PurgeScope =
  | { scope: 'all' }
  | { scope: 'web' }
  | { scope: 'content-type'; slug: string };

// Mirrors WebPurgeResult in apps/api/src/lib/purge-web-cache.ts — the outcome of
// the web (Nitro SWR HTML) purge, so the UI can tell the admin WHY the public
// site didn't change instead of showing a false success.
// - 'disabled'    → PURGE_SECRET unset on the API service (it never tried).
// - 'no_site_url' → no Site URL / internal URL to POST to.
// - 'http_error'  → website answered non-2xx (404 = its secret unset; 401 = mismatch).
// - 'unreachable' → couldn't reach the website (timeout / DNS / hairpin NAT).
export type WebPurgeResult =
  | { ok: true; purged: number }
  | {
      ok: false;
      reason: 'disabled' | 'no_site_url' | 'http_error' | 'unreachable';
      status?: number;
    };

export interface PurgeResult {
  scope: 'all' | 'web' | 'content-type';
  // Redis namespaces the server swept (empty for the web-only purge).
  purgedNamespaces: string[];
  // Outcome of the website-page-cache (Nitro SWR HTML) purge.
  web: WebPurgeResult;
}

export const cacheApi = {
  // Auth + tenant travel automatically via the httpOnly session cookie — the
  // client sends nothing extra. See apps/admin/src/lib/api.ts.
  purge: (body: PurgeScope) =>
    apiFetch<{ data: PurgeResult }>('/admin/cache/purge', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
