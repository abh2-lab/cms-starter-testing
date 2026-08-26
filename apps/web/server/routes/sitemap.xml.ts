import { defineEventHandler, getRequestURL, setHeader } from 'h3';

// Site map for the default content type + all published pages.
//
// Same-origin call into the public API (which Nitro proxies). Failures fall
// through to an empty <urlset/> rather than 500 so crawlers don't see a hard
// error during transient API outages.

interface ArchiveItem {
  slug: string;
  publishedAt: string | null;
}
interface ArchiveEnvelope {
  data: {
    items: ArchiveItem[];
    pagination: { totalPages: number };
  };
}

interface PageRow {
  slug: string;
  publishedAt: string | null;
}
interface PageListEnvelope {
  data: { items: PageRow[] };
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default defineEventHandler(async (event) => {
  const type = 'article';
  const origin = getRequestURL(event).origin;
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8');

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${origin}/` },
    { loc: `${origin}/stories` },
    { loc: `${origin}/contact` },
  ];

  // Collect all articles, walking pagination defensively.
  try {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 20) {
      const res = await $fetch<ArchiveEnvelope>(
        `/api/public/archive/${type}`,
        { query: { page, pageSize: 50 } },
      ).catch(() => null);
      if (!res) break;
      totalPages = res.data.pagination.totalPages;
      for (const it of res.data.items) {
        urls.push({
          loc: `${origin}/article/${encodeURIComponent(it.slug)}`,
          lastmod: it.publishedAt ?? undefined,
        });
      }
      page += 1;
    }
  } catch {
    // swallow
  }

  // Pages — best-effort. There isn't a public list endpoint today, so we hit
  // a small set of well-known slugs that any neutral seed creates.
  for (const slug of ['about', 'contact', 'privacy', 'terms']) {
    const res = await $fetch<PageListEnvelope | { data: PageRow }>(
      `/api/public/pages/${slug}`,
    ).catch(() => null);
    if (res && typeof res === 'object' && 'data' in res && res.data) {
      const row = res.data as PageRow;
      if (row && typeof row === 'object' && 'slug' in row && row.slug) {
        urls.push({
          loc: `${origin}/${encodeURIComponent(row.slug)}`,
          lastmod: row.publishedAt ?? undefined,
        });
      }
    }
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n` +
          `    <loc>${xmlEscape(u.loc)}</loc>\n` +
          (u.lastmod ? `    <lastmod>${xmlEscape(u.lastmod)}</lastmod>\n` : '') +
          `  </url>`,
      )
      .join('\n') +
    `\n</urlset>\n`;

  return body;
});
