import { generateHTML } from '@tiptap/html';
import {
  standardExtensions,
  Embed,
  PullQuote,
  PullquoteUnderline,
  SectionRule,
  LeadParagraph,
  InlineImage,
  Gallery,
  RawHTML,
} from '@cms/editor/extensions';
import { injectRawHtmlBlocks } from './sanitize-raw-html';
import { injectEmbedBlocks } from './inject-embed';

/**
 * Render a Tiptap doc (JSON) to HTML on the server.
 *
 * Uses the same standardExtensions list the admin editor mounts, plus every
 * custom CMS node the admin can insert — keeping the document schema in sync
 * across both sides. Without the full list, generateHTML throws "Unknown node
 * type: <name>" as soon as a doc contains anything beyond StarterKit's
 * built-ins, and silently drops nodes whose extension isn't passed in.
 *
 * Source is admin-authored and validated by buildContentDataSchema before
 * storage, so the output is trusted. The page renders this string via
 * v-html into a .article-body container (with a vue/no-v-html disable
 * block, justified inline).
 *
 * Returns an empty string on any error so the page degrades to "no body"
 * rather than crashing the SSR render.
 */
export function renderTiptap(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  try {
    const html = generateHTML(doc, [
      ...standardExtensions,
      // Order doesn't matter for generateHTML, but list every custom node
      // the admin editor can produce so none get silently dropped at render.
      PullQuote,
      PullquoteUnderline,
      SectionRule,
      LeadParagraph,
      InlineImage,
      Gallery,
      Embed,
      RawHTML,
    ]);
    // RawHTML and Embed both serialise to empty placeholder divs carrying their
    // payload in data-attrs; hydrate each into real markup. RawHTML decodes +
    // sanitises arbitrary author HTML; Embed turns a stored URL into a YouTube
    // player or link card. Independent placeholder shapes, so order is moot.
    return injectEmbedBlocks(injectRawHtmlBlocks(html));
  } catch (err) {
    console.warn('[tiptap] render failed', err);
    return '';
  }
}
