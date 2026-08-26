import {
  defineEventHandler,
  getRequestHeader,
  setResponseStatus,
} from 'h3';

// Nitro auto-imports useStorage into server routes at build time; its type
// hides behind the #imports alias ESLint's project service can't resolve
// here (same boundary as the security-headers middleware). Declare the
// narrow surface we use so the file stays type-checked.
declare const useStorage: (base?: string) => {
  getKeys: () => Promise<string[]>;
  removeItem: (key: string) => Promise<void>;
};

// Nitro route-cache purge (theme engine v2.0). Publishing a theme override
// changes pages the prod routeRules SWR-cache (`/`, `/stories*`) — their
// cached HTML embeds the OLD composed payload, so Redis invalidation alone
// isn't enough. The API calls this (fail-open, shared PURGE_SECRET header)
// right after a publish/reset.
//
// Blunt by design: clears the WHOLE `cache` storage mount instead of
// enumerating route keys — Nitro's internal key format (nitro:routes:…)
// varies across versions, and only a handful of routes are SWR'd, so a full
// clear costs a couple of re-renders and is version-proof.
//
// Deployment caveat: the default prod cache driver is in-process memory, so
// this purges THIS instance — exactly right for the single-container
// Coolify install. Multi-replica deploys need a shared cache storage mount
// (or per-replica fan-out) before this guarantees global freshness.

export default defineEventHandler(async (event) => {
  const secret = process.env['PURGE_SECRET'];
  if (!secret || secret.length === 0) {
    setResponseStatus(event, 404);
    return { error: 'purge_disabled' };
  }
  const provided = getRequestHeader(event, 'x-purge-secret');
  if (provided !== secret) {
    setResponseStatus(event, 401);
    return { error: 'unauthorized' };
  }

  const storage = useStorage('cache');
  const keys = await storage.getKeys();
  await Promise.all(keys.map((k) => storage.removeItem(k)));
  return { purged: keys.length };
});
