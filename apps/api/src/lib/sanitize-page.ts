import sanitizeHtml from 'sanitize-html';
import postcss, { type Root, type Rule, type AtRule, type Declaration } from 'postcss';

// Sanitizer for STATIC pages — the admin pastes HTML + CSS, we strip every
// active surface (script execution, redirects, iframe smuggling, CSS-driven
// JS) and scope the CSS so it cannot leak out of the page wrapper.
//
// Threat model: an admin can paste anything; visitors must never see active
// content. Run sanitization ON SAVE (so the row is hot-render-safe) AND ON
// RENDER (defense in depth — a malicious migration / direct DB write must
// not bypass the protection).
//
// Out of scope (intentionally):
//   - SVG <script>: we drop the <svg> tag entirely; inline SVG is not in our
//     content needs and is the largest XSS-via-image vector.
//   - <iframe>: dropped. Sites that need embeds use dynamic blocks instead.
//   - Form submission: <form>/<input>/etc. are allowed for visual layout
//     ONLY if action attributes are empty — but we strip action= entirely.

// ─── HTML allow-list ───────────────────────────────────────────────────────

const ALLOWED_TAGS: string[] = [
  // Document structure
  'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
  // Headings + text
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup',
  'mark', 'cite', 'q', 'blockquote', 'code', 'pre', 'kbd', 'samp', 'time',
  'br', 'hr', 'wbr',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Media (images only — no script-bearing media)
  'img', 'figure', 'figcaption', 'picture', 'source',
  // Inline interaction (limited)
  'a', 'button', 'details', 'summary',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  // Class + id work on every tag — used heavily by pasted layouts.
  '*': ['class', 'id', 'style', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden'],
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
  picture: [],
  source: ['srcset', 'media', 'type'],
  button: ['type'],   // 'button' only — see transformations
  table: ['border'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span'],
  colgroup: ['span'],
  time: ['datetime'],
};

const ALLOWED_SCHEMES: string[] = ['http', 'https', 'mailto', 'tel'];
const ALLOWED_SCHEMES_BY_TAG: Record<string, string[]> = {
  // img can also carry data:image/* (handled via the iframe-style data filter).
  img: ['http', 'https', 'data'],
};

/**
 * Sanitize a chunk of admin-pasted HTML for safe SSR. Strips scripts, event
 * handlers, dangerous schemes, iframes/embeds/objects, and anything not on
 * the explicit allow-list above. Always wraps the final body in a div with
 * `data-page-id="${pageId}"` so the matching scoped CSS attaches correctly.
 */
export function sanitizePageHtml(rawHtml: string, pageId: string): string {
  if (!pageId || !/^[A-Za-z0-9_-]{1,64}$/.test(pageId)) {
    throw new Error(
      'sanitizePageHtml: pageId must be a short alphanumeric identifier',
    );
  }
  const cleaned = sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: ALLOWED_SCHEMES_BY_TAG,
    // data:image/* OK; data:text/html (the smuggle) is NOT.
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    // No <script>, no <style> (CSS goes through the separate sanitizer below
    // so it can be properly scoped), no on*-handlers.
    disallowedTagsMode: 'discard',
    allowedStyles: {
      // Inline `style="..."` is allowed but only with safe property names.
      '*': {
        color: [/^.*$/], 'background-color': [/^.*$/], 'background': [/^.*$/],
        'font-size': [/^.*$/], 'font-weight': [/^.*$/], 'font-family': [/^.*$/],
        'text-align': [/^.*$/], 'line-height': [/^.*$/], 'letter-spacing': [/^.*$/],
        padding: [/^.*$/], margin: [/^.*$/], width: [/^.*$/], height: [/^.*$/],
        'max-width': [/^.*$/], 'max-height': [/^.*$/], 'min-width': [/^.*$/], 'min-height': [/^.*$/],
        display: [/^.*$/], 'flex-direction': [/^.*$/], 'justify-content': [/^.*$/], 'align-items': [/^.*$/],
        gap: [/^.*$/], border: [/^.*$/], 'border-radius': [/^.*$/],
      },
    },
    transformTags: {
      // Force every anchor to noopener+noreferrer; otherwise pasted target=_blank
      // links can tabnab the parent.
      a: (tagName, attribs) => {
        const out: Record<string, string> = { ...attribs };
        if (out['target']) {
          const existingRel = (out['rel'] ?? '').split(/\s+/).filter(Boolean);
          const merged = new Set([...existingRel, 'noopener', 'noreferrer']);
          out['rel'] = Array.from(merged).join(' ');
        }
        return { tagName, attribs: out };
      },
      // <button> with type=submit on a form-less page can still cause weird
      // browser behaviour; pin to type=button.
      button: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, type: 'button' },
      }),
      // sanitize-html allows `data:` on <img> via allowedSchemesByTag but
      // does not subdivide by MIME type. We need data:image/{png,jpeg,gif,webp}
      // through and data:text/html / data:image/svg+xml refused. Drop the
      // src attribute when it fails the explicit check; an &lt;img&gt; with no src
      // renders as broken-image, which is the correct visible signal that
      // the source was rejected.
      img: (tagName, attribs) => {
        const src = attribs['src'];
        if (typeof src === 'string' && src.toLowerCase().startsWith('data:')) {
          if (!/^data:image\/(png|jpe?g|gif|webp);/i.test(src)) {
            const { src: _drop, ...rest } = attribs;
            return { tagName, attribs: rest };
          }
        }
        return { tagName, attribs };
      },
    },
  });
  return `<div data-page-id="${pageId}">${cleaned}</div>`;
}

// ─── CSS allow-list ────────────────────────────────────────────────────────

// At-rules that can carry style declarations (we recurse into them) AND are
// safe in user-pasted CSS. Anything else (e.g. @import, @charset, @namespace,
// @document) is dropped outright.
const SAFE_NESTING_ATRULES = new Set(['media', 'supports', 'container', 'layer']);

// URL schemes we allow inside `url(...)` references. Anything else is
// stripped: `javascript:`, `data:text/html`, bare `data:` (no MIME), etc.
const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function isSafeUrl(rawUrl: string): boolean {
  const url = rawUrl.trim();
  if (url === '') return false;
  if (url.startsWith('#')) return true; // local fragment, fine for SVG masks
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;
  // http(s) and data:image/* explicit allow-list.
  if (/^https?:\/\//i.test(url)) return true;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(url)) {
    // Even data:image/svg+xml can ship inline <script>. Only allow base64-encoded
    // SVG that survives our text scan: reject if the decoded body contains the
    // string "<script". Simpler safer: refuse svg+xml outright.
    if (/^data:image\/svg/i.test(url)) return false;
    return true;
  }
  return false;
}

function scopeSelector(selector: string, pageId: string): string {
  // Prefix every comma-separated selector clause with `[data-page-id="..."]`.
  // For `:root` and `html`/`body` (which appear in pasted-from-IDE markup),
  // map them onto the page wrapper instead of leaking globally.
  const prefix = `[data-page-id="${pageId}"]`;
  return selector
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const lower = s.toLowerCase();
      if (lower === ':root' || lower === 'html' || lower === 'body') return prefix;
      return `${prefix} ${s}`;
    })
    .join(', ');
}

function processNode(node: Root | AtRule, pageId: string): void {
  // Drop disallowed at-rules outright. Walk the children we keep.
  const toRemove: Array<Rule | AtRule | Declaration> = [];
  node.walk((child) => {
    if (child.type === 'atrule') {
      if (!SAFE_NESTING_ATRULES.has(child.name.toLowerCase())) {
        toRemove.push(child);
      }
    }
    if (child.type === 'decl') {
      // Filter url(...) references. If ANY url in the declaration is unsafe,
      // drop the entire declaration — a partially-cleaned value is harder to
      // reason about than a missing property.
      let safe = true;
      child.value.replace(URL_RE, (_match, _quote, ref) => {
        if (!isSafeUrl(ref as string)) safe = false;
        return _match;
      });
      // Strip CSS expressions (legacy IE; can carry JS in some browsers).
      if (/expression\s*\(/i.test(child.value)) safe = false;
      // Strip behaviour: url() (IE HTML Component, executes JS).
      if (/\bbehavior\s*:/i.test(`${child.prop}:${child.value}`)) safe = false;
      if (!safe) toRemove.push(child);
    }
    if (child.type === 'rule') {
      // Scope the selector to the page wrapper.
      child.selector = scopeSelector(child.selector, pageId);
    }
  });
  for (const r of toRemove) r.remove();
}

/**
 * Sanitize and scope a chunk of admin-pasted CSS so it cannot escape its
 * page wrapper. Drops `@import`, `@charset`, etc.; allows `@media` /
 * `@supports` / `@container` / `@layer` (recursing into them); rewrites
 * every selector to `[data-page-id="${pageId}"] ...`; filters `url(...)`
 * to http(s) and `data:image/*` (no SVG, no JS schemes).
 */
export function sanitizePageCss(rawCss: string, pageId: string): string {
  if (!pageId || !/^[A-Za-z0-9_-]{1,64}$/.test(pageId)) {
    throw new Error(
      'sanitizePageCss: pageId must be a short alphanumeric identifier',
    );
  }
  let root: Root;
  try {
    root = postcss.parse(rawCss);
  } catch {
    // Malformed CSS — drop the whole thing rather than emit something
    // half-parsed. The admin will see an empty &lt;style&gt; tag and notice.
    return '';
  }
  processNode(root, pageId);
  return root.toString();
}

/**
 * Convenience: sanitize both halves at once. Returns the wrapped HTML and
 * the scoped CSS as separate strings; the render path injects them into a
 * &lt;style&gt; tag immediately preceding the body div.
 */
export function sanitizeStaticPage(
  rawHtml: string,
  rawCss: string,
  pageId: string,
): { html: string; css: string } {
  return {
    html: sanitizePageHtml(rawHtml, pageId),
    css: sanitizePageCss(rawCss, pageId),
  };
}
