import { env } from '@cms/config';
import { resolveSiteUrl } from './site-url.js';

// Best-effort purge of the public site's nitro route cache (SWR'd HTML). Mirrors
// the cache-invalidation fail-open contract everywhere else: the caller's own
// write has already committed — a dead web container, a missing site URL, or an
// unset PURGE_SECRET must never throw. It now RETURNS the outcome (while still
// never throwing) so callers that care can surface *why* the public site didn't
// change — e.g. the Tools → Purge Cache page warns the admin when the
// PURGE_SECRET handshake isn't wired up on both services in production.
// See apps/web/server/routes/api/_purge.post.ts for the receiving end.

type WarnLogger = { warn: (obj: unknown, msg: string) => void };

/**
 * Outcome of a web-cache purge. `ok` means we reached the web app's /api/_purge
 * and it cleared `purged` cache entries. Otherwise `reason` says why it did not:
 * - 'disabled'    — PURGE_SECRET is unset on THIS (API) service, so we did not try.
 * - 'no_site_url' — site_settings.siteUrl is unset, so there is nowhere to POST.
 * - 'http_error'  — the web app answered non-2xx (404 = its PURGE_SECRET is unset;
 *                   401 = it is set but does not match this service's value).
 * - 'unreachable' — the request threw (timeout / DNS / network).
 */
export type WebPurgeResult =
  | { ok: true; purged: number }
  | {
      ok: false;
      reason: 'disabled' | 'no_site_url' | 'http_error' | 'unreachable';
      status?: number;
    };

export async function purgeWebCache(
  log: WarnLogger,
  tenantId: string | null,
): Promise<WebPurgeResult> {
  const secret = env.PURGE_SECRET;
  if (!secret || secret.length === 0) return { ok: false, reason: 'disabled' };

  try {
    // Prefer an explicit internal URL (server-to-server; bypasses the public
    // domain — see WEB_INTERNAL_URL). Fall back to the per-tenant public site URL.
    const base = env.WEB_INTERNAL_URL || (await resolveSiteUrl(tenantId));
    if (!base) {
      log.warn({}, 'web cache purge skipped: no web URL configured');
      return { ok: false, reason: 'no_site_url' };
    }
    const res = await fetch(`${base.replace(/\/$/, '')}/api/_purge`, {
      method: 'POST',
      headers: { 'x-purge-secret': secret },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'web cache purge returned non-2xx');
      return { ok: false, reason: 'http_error', status: res.status };
    }
    let purged = 0;
    try {
      const bodyJson = (await res.json()) as { purged?: number };
      if (typeof bodyJson?.purged === 'number') purged = bodyJson.purged;
    } catch {
      // Non-JSON 2xx body — count unknown, still a success.
    }
    return { ok: true, purged };
  } catch (err) {
    log.warn({ err }, 'web cache purge failed (fail-open)');
    return { ok: false, reason: 'unreachable' };
  }
}
