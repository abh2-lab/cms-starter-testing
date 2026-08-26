import sanitizeHtml from 'sanitize-html';

// Render-time sanitiser for the `rawHtml` escape-hatch node. The admin lets a
// journalist paste arbitrary markup; it is stored verbatim and must be scrubbed
// of every active surface before a reader ever sees it. The allow-list mirrors
// the static-page sanitiser in apps/api/src/lib/sanitize-page.ts (same threat
// model: no script/iframe/svg/object, no on*-handlers, no js: / data:text/html)
// — sanitising on render is defence-in-depth, so a malicious direct DB write
// can never reach the page either.

const ALLOWED_TAGS: string[] = [
  'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup',
  'mark', 'cite', 'q', 'blockquote', 'code', 'pre', 'kbd', 'samp', 'time',
  'br', 'hr', 'wbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'img', 'figure', 'figcaption', 'picture', 'source',
  'a', 'button', 'details', 'summary',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': ['class', 'id', 'style', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden'],
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
  picture: [],
  source: ['srcset', 'media', 'type'],
  button: ['type'],
  table: ['border'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span'],
  colgroup: ['span'],
  time: ['datetime'],
};

const ALLOWED_SCHEMES: string[] = ['http', 'https', 'mailto', 'tel'];
const ALLOWED_SCHEMES_BY_TAG: Record<string, string[]> = {
  img: ['http', 'https', 'data'],
};

/**
 * Sanitise a chunk of admin-authored raw HTML for safe SSR injection. Strips
 * scripts, event handlers, dangerous schemes, iframes/objects, and anything not
 * on the explicit allow-list above.
 */
export function sanitizeRawHtml(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: ALLOWED_SCHEMES_BY_TAG,
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    allowedStyles: {
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
      // Force every anchor to noopener+noreferrer so target=_blank can't tabnab.
      a: (tagName, attribs) => {
        const out: Record<string, string> = { ...attribs };
        if (out['target']) {
          const existingRel = (out['rel'] ?? '').split(/\s+/).filter(Boolean);
          const merged = new Set([...existingRel, 'noopener', 'noreferrer']);
          out['rel'] = Array.from(merged).join(' ');
        }
        return { tagName, attribs: out };
      },
      // Allow data:image/{png,jpeg,gif,webp} only; drop the src otherwise.
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
}

// generateHTML serialises a rawHtml node to
// `<div data-html="…" data-raw-html=""></div>` where the markup lives inside the
// data-html attribute with ONLY `"`→&quot; and `&`→&amp; escaped — the `<`/`>`
// stay literal. Decode those back (`&amp;` LAST so one encoding level is undone
// exactly once); the `&lt;`/`&gt;`/numeric cases are harmless no-ops here but
// keep us robust if a future serialiser does encode them.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2f;/gi, '/')
    .replace(/&amp;/g, '&');
}

// Because data-html contains literal `>` (see above), the match can't span the
// opening tag with `[^>]*` — anchor on the exact `data-html="…" data-raw-html=""`
// attribute pair the serialiser emits. The value has no literal `"` (all are
// &quot;), so `[^"]*` captures it whole.
const RAW_HTML_RE =
  /<div\s+data-html="([^"]*)"\s+data-raw-html=""\s*>\s*<\/div>/gi;

/**
 * Replace each serialised `rawHtml` placeholder in a generateHTML() string with
 * its sanitised markup. A placeholder with empty `data-html` renders to nothing.
 */
export function injectRawHtmlBlocks(html: string): string {
  return html.replace(RAW_HTML_RE, (_full, encoded: string) => {
    if (!encoded) return '';
    return sanitizeRawHtml(decodeHtmlEntities(encoded));
  });
}
