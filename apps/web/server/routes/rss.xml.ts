import { defineEventHandler, getQuery, getRequestURL, setHeader } from 'h3';

// RSS 2.0 feed for the default content type (override via ?type=<slug>).
// Pulls the latest archive page from the public API. Failures fall through
// to an empty channel rather than 500.

interface ArchiveItem {
  title: string;
  slug: string;
  publishedAt: string | null;
  excerpt: string | null;
  // Multi-author byline shape — same as the public archive API. null when
  // the row has no byline; otherwise one entry per author. RSS 2.0 only
  // has one <author> per item, so the renderer joins them with " & ".
  authors: { displayName: string; slug: string | null }[] | null;
}
interface ArchiveEnvelope {
  data: {
    items: ArchiveItem[];
  };
}
interface SiteSettingsEnvelope {
  data: {
    siteName: string;
    siteDescription: string | null;
    siteUrl: string;
  } | null;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  // `?type=<slug>` overrides the default; anything non-string falls through.
  const qType = query['type'];
  const type = typeof qType === 'string' ? qType : 'article';
  const origin = getRequestURL(event).origin;
  setHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8');

  const settings = await $fetch<SiteSettingsEnvelope>(
    '/api/public/site-settings',
  ).catch(() => null);

  const siteName = settings?.data?.siteName ?? 'Site';
  const siteDescription = settings?.data?.siteDescription ?? '';

  let items: ArchiveItem[];
  try {
    const res = await $fetch<ArchiveEnvelope>(
      `/api/public/archive/${type}`,
      { query: { page: 1, pageSize: 30 } },
    );
    items = res.data.items;
  } catch {
    items = [];
  }

  const itemsXml = items
    .map((it) => {
      const link = `${origin}/article/${encodeURIComponent(it.slug)}`;
      const parts = [
        `      <title>${cdata(it.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
      ];
      if (it.publishedAt) {
        parts.push(
          `      <pubDate>${xmlEscape(new Date(it.publishedAt).toUTCString())}</pubDate>`,
        );
      }
      // RSS 2.0 supports one <author> per item. Join multiple bylines
      // with " & " (Decode editorial convention) so feed readers still
      // surface co-authored work.
      if (it.authors && it.authors.length > 0) {
        const names = it.authors.map((a) => a.displayName).join(' & ');
        parts.push(`      <author>${cdata(names)}</author>`);
      }
      if (it.excerpt) {
        parts.push(`      <description>${cdata(it.excerpt)}</description>`);
      }
      return `    <item>\n${parts.join('\n')}\n    </item>`;
    })
    .join('\n');

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0">\n` +
    `  <channel>\n` +
    `    <title>${cdata(siteName)}</title>\n` +
    `    <link>${xmlEscape(origin)}</link>\n` +
    `    <description>${cdata(siteDescription)}</description>\n` +
    `    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${xmlEscape(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml" />\n` +
    (itemsXml ? `${itemsXml}\n` : '') +
    `  </channel>\n` +
    `</rss>\n`;

  return body;
});
