import { createError, defineEventHandler, getQuery } from 'h3';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Server-side OG/Twitter-card resolver for the embed block's Card mode (and for
// Link-mode URLs that match no known provider). The browser can't fetch
// arbitrary cross-origin pages, so the client composable (useEmbeds) calls this
// route, which fetches the page, extracts its Open Graph metadata, and caches
// the result. Results land in the same Nitro `cache` mount that
// server/routes/api/_purge.post.ts wipes on publish.
//
// SSRF is the one genuinely new attack surface (a server fetch of a user-
// supplied URL), so the URL is validated hard: https only, no private/loopback/
// link-local hosts (checked on the literal host AND every resolved address),
// 5s timeout, ~512KB body cap, text/html only, and each redirect hop is
// re-validated. (Residual DNS-rebinding TOCTOU is accepted for this single-
// publisher, journalist-supplied-URL threat model.)

// Nitro auto-imports useStorage; its type hides behind the #imports alias
// ESLint's project service can't resolve here (same boundary as _purge.post.ts).
declare const useStorage: (base?: string) => {
  getItem: <T = unknown>(key: string) => Promise<T | null>;
  setItem: (key: string, value: unknown) => Promise<void>;
};

interface OgMeta {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message });
}

function isPrivateIp(ip: string): boolean {
  // Unwrap IPv4-mapped IPv6 (::ffff:1.2.3.4) to its v4 tail.
  const v4 =
    isIP(ip) === 4
      ? ip
      : ip.toLowerCase().startsWith('::ffff:')
        ? ip.slice(ip.lastIndexOf(':') + 1)
        : null;
  if (v4 && isIP(v4) === 4) {
    const o = v4.split('.').map(Number);
    const a = o[0] ?? 0;
    const b = o[1] ?? 0;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === '::1' ||
    v6 === '::' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe80')
  );
}

async function assertPublicUrl(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return badRequest('invalid url');
  }
  if (u.protocol !== 'https:') return badRequest('only https URLs are allowed');
  const host = u.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return badRequest('host not allowed');
  }
  if (isIP(host) !== 0 && isPrivateIp(host)) return badRequest('host not allowed');
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return badRequest('host could not be resolved');
  }
  if (addrs.some((a) => isPrivateIp(a.address))) {
    return badRequest('host resolves to a private address');
  }
  return u.toString();
}

// Follow up to MAX_REDIRECTS hops, re-validating each Location against the SSRF
// guard so a page can't bounce us onto an internal address.
async function safeFetch(
  start: string,
): Promise<Awaited<ReturnType<typeof fetch>> | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (hop > 0) await assertPublicUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; HocalwireCMS-LinkPreview/1.0)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      url = new URL(loc, url).toString();
      continue;
    }
    return res;
  }
  return null;
}

async function readCapped(
  res: Awaited<ReturnType<typeof fetch>>,
  maxBytes: number,
): Promise<string> {
  const body = res.body;
  if (!body) return res.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match a <meta> tag for the given og:/twitter:/name property, in either
// attribute order (property-then-content or content-then-property).
function pick(html: string, prop: string): string | null {
  const p = escapeRe(prop);
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${p}["'][^>]*?content=["']([^"']*)["']`,
    'i',
  ).exec(html);
  if (a?.[1]) return decodeEntities(a[1]);
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${p}["']`,
    'i',
  ).exec(html);
  return b?.[1] ? decodeEntities(b[1]) : null;
}

function titleTag(html: string): string | null {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m?.[1] ? decodeEntities(m[1]) : null;
}

// Resolve a possibly-relative image URL to an absolute https URL (drop non-https
// to avoid mixed-content blocking on the page).
function absImage(img: string | null, base: string): string | null {
  if (!img) return null;
  try {
    const u = new URL(img, base);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function fetchMeta(url: string): Promise<OgMeta> {
  const empty: OgMeta = {
    url,
    title: null,
    description: null,
    image: null,
    siteName: null,
  };
  let res: Awaited<ReturnType<typeof fetch>> | null;
  try {
    res = await safeFetch(url);
  } catch {
    // A redirect failed the SSRF re-validation, or the network errored.
    return empty;
  }
  if (!res || !res.ok) return empty;
  const ctype = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(ctype)) return empty;
  let html: string;
  try {
    html = await readCapped(res, MAX_BYTES);
  } catch {
    return empty;
  }
  return {
    url,
    title:
      pick(html, 'og:title') ?? pick(html, 'twitter:title') ?? titleTag(html),
    description:
      pick(html, 'og:description') ??
      pick(html, 'twitter:description') ??
      pick(html, 'description'),
    image: absImage(
      pick(html, 'og:image') ?? pick(html, 'twitter:image'),
      url,
    ),
    siteName: pick(html, 'og:site_name'),
  };
}

export default defineEventHandler(async (event): Promise<OgMeta> => {
  const q = getQuery(event);
  const raw = typeof q['url'] === 'string' ? q['url'] : '';
  const target = await assertPublicUrl(raw);

  const storage = useStorage('cache');
  const key = `embed:og:${target}`;
  const hit = await storage.getItem<{ at: number; meta: OgMeta }>(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.meta;

  const meta = await fetchMeta(target);
  await storage.setItem(key, { at: Date.now(), meta });
  return meta;
});
