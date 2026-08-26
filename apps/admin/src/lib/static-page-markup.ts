// Helpers for the single-field "Page Content" editor on static pages. The
// page row stores HTML and CSS in separate columns (the public renderer puts
// CSS in <Head> as a <style> tag and the HTML body inside the scoped wrapper
// div). The admin edits both as ONE blob — they paste a chunk of markup that
// may contain inline <style> tags. These helpers handle the round-trip:
//
//   - splitMarkup pulls <style>...</style> blocks out of the combined input
//     and returns html + css separately. Multiple blocks are concatenated in
//     source order.
//   - combineMarkup puts the css back into a single leading <style> block so
//     reloading a saved row shows roughly what the admin typed (modulo the
//     selector-scoping the server applies to css on save).
//
// Raw HTML/CSS are stored and published VERBATIM — there is no sanitization
// (admin-only authoring surface; trusted-staff model, like WordPress's
// unfiltered_html). These helpers don't sanitise — they just route the markup
// into the right column.

const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>\s*/gi;

/**
 * Split a combined markup blob into HTML body and CSS rules.
 *
 * Every <style>…</style> block is pulled out; the rest stays in `html`.
 * Blocks are concatenated with a blank-line separator so the saved CSS
 * column doesn't fuse rules from different blocks into one declaration.
 */
export function splitMarkup(combined: string): {
  html: string;
  css: string;
} {
  if (!combined) return { html: '', css: '' };
  const cssChunks: string[] = [];
  const html = combined
    .replace(STYLE_BLOCK_RE, (_match, body) => {
      const trimmed = String(body).trim();
      if (trimmed) cssChunks.push(trimmed);
      return '';
    })
    .replace(/^\s*\n+/, '');
  return { html, css: cssChunks.join('\n\n') };
}

/**
 * Combine HTML body and CSS rules into a single markup blob suitable for the
 * unified editor. Empty CSS produces just the HTML — the editor stays clean
 * for pages that don't use custom styles.
 */
export function combineMarkup(html: string, css: string): string {
  const cssTrimmed = (css ?? '').trim();
  if (!cssTrimmed) return html ?? '';
  return `<style>\n${cssTrimmed}\n</style>\n\n${html ?? ''}`;
}
