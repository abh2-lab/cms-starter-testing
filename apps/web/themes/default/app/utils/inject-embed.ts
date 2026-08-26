import { renderLinkEmbed } from './embed-providers';
import { sanitizeEmbedCode } from './sanitize-embed-code';
import { captionHtml, escapeHtml, isHttp } from './embed-util';

// Render-time hydration for the `embed` block. The admin stores only
// { type, value, caption } (value = a URL for link/card, or raw embed code for
// iframe mode); generateHTML serialises that to an EMPTY placeholder
// `<div data-type=… data-value=… data-caption=… [data-url=…] data-embed=""></div>`.
// Here we replace each placeholder with real markup per mode:
//   link   → known-provider embed (embed-providers), else an OG card placeholder
//   iframe → the pasted embed code, sanitised (sanitize-embed-code)
//   card   → an OG card placeholder (useEmbeds fills it on the client)
// Legacy {url, provider} docs serialise `data-url` (no data-value); we read
// data-value with a data-url fallback so they keep working with no migration.
//
// Mirrors the injectRawHtmlBlocks pattern: one post-pass over the generated HTML
// string, composing with SSR + route caching with zero server-side work.

// data-* values are serialised with only `&`→&amp; and `"`→&quot; (the same
// escaping the rawHtml placeholder uses); undo those two to recover the original.
function decodeAttr(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function getAttr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeAttr(m[1] ?? '') : '';
}

// OG link-preview card. SSR emits a working <a> fallback; useEmbeds() fetches
// the page's OG metadata on the client and fills in image/title/description.
function cardPlaceholder(url: string, caption: string): string {
  const safe = escapeHtml(url);
  return (
    `<figure class="embed embed--card" data-embed-card data-embed-url="${safe}">` +
    `<a class="embed-card__fallback" href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>` +
    captionHtml(caption) +
    `</figure>`
  );
}

function renderEmbed(type: string, value: string, caption: string): string {
  if (type === 'iframe') {
    const code = sanitizeEmbedCode(value);
    return code
      ? `<figure class="embed embed--code">${code}${captionHtml(caption)}</figure>`
      : '';
  }
  if (type === 'card') {
    return value && isHttp(value) ? cardPlaceholder(value, caption) : '';
  }
  // 'link' (default): a known provider → a real embed; any other https URL → card.
  if (!value || !isHttp(value)) return '';
  return renderLinkEmbed(value, caption) ?? cardPlaceholder(value, caption);
}

// Empty atom → `<div …></div>`. Attribute values never contain a literal `"`
// (serialised to &quot;) but CAN contain a literal `>` (iframe embed code in
// data-value). Consume the tag as runs of non-`>"` chars OR whole `"…"` quoted
// strings so a `>` inside a value can't end the match early. The alternation is
// unambiguous on its first char (quote vs not) ⇒ no catastrophic backtracking.
const EMBED_RE = /<div((?:[^>"]|"[^"]*")*)>\s*<\/div>/gi;

/**
 * Replace each serialised `embed` placeholder in a generateHTML() string with
 * its hydrated markup. Non-embed empty divs pass through untouched.
 */
export function injectEmbedBlocks(html: string): string {
  return html.replace(EMBED_RE, (full: string, tag: string) => {
    if (!/\bdata-embed\b/.test(tag)) return full;
    const type = getAttr(tag, 'data-type') || 'link';
    const value = getAttr(tag, 'data-value') || getAttr(tag, 'data-url');
    const caption = getAttr(tag, 'data-caption');
    return renderEmbed(type, value, caption);
  });
}
