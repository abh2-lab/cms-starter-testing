// Minimal HTML stripper for untrusted public-submission text. This is NOT a
// rich-HTML sanitizer — public submissions are plain text / simple markdown, so
// the safe move is to remove markup entirely (defense against stored HTML/XSS
// that an editor might later paste into a rendered field) rather than try to
// allow-list tags. Dependency-free by design (project policy: no new deps).
//
// Horizontal whitespace is collapsed but line breaks are preserved, so a
// multi-paragraph submission body keeps its shape. For single-line fields
// (title, name, email) collapse the remaining newlines at the call site.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function stripHtml(input: string): string {
  return (
    input
      // Drop <script>/<style> blocks together with their contents first.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      // Remove every complete tag, then any dangling unterminated tag start
      // (e.g. "<img onerror=…" with no closing ">"). The second pass only fires
      // on "<" followed by a letter or "/", so plain text like "a < b" is kept.
      .replace(/<[^>]*>/g, ' ')
      .replace(/<\/?[a-z][^>]*$/gi, ' ')
      // Decode the handful of entities that otherwise survive as literal text.
      .replace(/&(#?\w+);/g, (match, code: string): string => {
        if (code.startsWith('#')) {
          const cp =
            code.startsWith('#x') || code.startsWith('#X')
              ? Number.parseInt(code.slice(2), 16)
              : Number.parseInt(code.slice(1), 10);
          return Number.isFinite(cp) && cp > 0
            ? String.fromCodePoint(cp)
            : match;
        }
        return NAMED_ENTITIES[code.toLowerCase()] ?? match;
      })
      // Collapse spaces/tabs (but not newlines), tidy whitespace around
      // newlines, and cap consecutive blank lines.
      .replace(/[^\S\n]+/g, ' ')
      .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Single-line variant: strip HTML and flatten all whitespace to single spaces. */
export function stripHtmlInline(input: string): string {
  return stripHtml(input).replace(/\s+/g, ' ').trim();
}
