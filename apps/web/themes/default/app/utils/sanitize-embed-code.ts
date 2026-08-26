import sanitizeHtml from 'sanitize-html';

// Sanitiser for `iframe` (Embed-code) mode. The journalist pastes an <iframe>
// or a platform embed snippet (e.g. the publish.x.com blockquote). We keep
// iframes (https only) and known social blockquotes but STRIP every <script> —
// the public composable (useEmbeds) re-supplies the widget script for
// recognised blockquotes, so author scripts never reach the DOM. This is a more
// permissive sibling of sanitize-raw-html.ts (which strips iframes entirely).

const ALLOWED_TAGS: string[] = [
  'iframe',
  'blockquote',
  'a',
  'p',
  'div',
  'span',
  'br',
  'figure',
  'figcaption',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  iframe: [
    'src',
    'width',
    'height',
    'title',
    'frameborder',
    'allow',
    'allowfullscreen',
    'allowtransparency',
    'scrolling',
    'loading',
    'referrerpolicy',
    'style',
  ],
  blockquote: [
    'class',
    'cite',
    'data-dnt',
    'data-width',
    'data-video-id',
    'data-lang',
    'data-theme',
    'data-instgrm-captioned',
    'data-instgrm-permalink',
    'data-instgrm-version',
    'style',
  ],
  a: ['href', 'title', 'target', 'rel'],
  '*': ['class'],
};

/**
 * Sanitise admin-pasted embed code for safe SSR injection. Keeps iframes
 * (https only) and known social blockquotes; discards scripts, event handlers,
 * and anything off the allow-list above.
 */
export function sanitizeEmbedCode(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['https'],
    allowedSchemesByTag: { a: ['https', 'http'] },
    allowedSchemesAppliedToAttributes: ['src', 'href', 'cite'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    allowedStyles: {
      '*': {
        width: [/^.*$/],
        height: [/^.*$/],
        'max-width': [/^.*$/],
        'min-width': [/^.*$/],
        'max-height': [/^.*$/],
        'min-height': [/^.*$/],
        margin: [/^.*$/],
        'margin-top': [/^.*$/],
        'margin-bottom': [/^.*$/],
        'margin-left': [/^.*$/],
        'margin-right': [/^.*$/],
        padding: [/^.*$/],
        border: [/^.*$/],
        'border-radius': [/^.*$/],
        background: [/^.*$/],
        display: [/^.*$/],
      },
    },
    transformTags: {
      // Force noopener/noreferrer + new-tab on any link in the snippet.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      }),
    },
    // Drop any iframe left without an absolute-https src (a non-https src is
    // stripped above, which would otherwise leave a blank <iframe>).
    exclusiveFilter: (frame) =>
      frame.tag === 'iframe' &&
      !(
        typeof frame.attribs['src'] === 'string' &&
        /^https:\/\//i.test(frame.attribs['src'])
      ),
  });
}
