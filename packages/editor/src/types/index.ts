// Attribute types for each custom node, the union of custom node names, and a
// minimal structural model of a Tiptap document. This module is intentionally
// runtime-free (no zod, no @tiptap) so `@cms/editor/types` can be imported by
// any layer for type-only use. The matching runtime validation lives in
// `@cms/editor/validators` and must be kept in parity with these shapes.

export type ImageWidth = 'full' | 'half' | 'constrained';
export type ImageFloat = 'left' | 'right' | null;
export type GalleryLayout = 'grid' | 'slider' | 'masonry';
export type EmbedProvider = 'youtube' | 'twitter' | 'instagram' | 'generic';
export type EmbedMode = 'link' | 'iframe' | 'card';

export interface InlineImageAttrs {
  /** UUID referencing the media table. Never a URL or S3 key. */
  mediaId: string;
  caption?: string | null;
  credit?: string | null;
  width: ImageWidth;
  float: ImageFloat;
}

export interface GalleryAttrs {
  /** Ordered UUIDs referencing the media table. */
  mediaIds: string[];
  layout: GalleryLayout;
  caption?: string | null;
}

export interface EmbedAttrs {
  /** The journalist-chosen mode. */
  type: EmbedMode;
  /** A URL (link/card mode) or raw embed code (iframe mode). */
  value: string;
  caption?: string | null;
}

export interface RawHtmlAttrs {
  html: string;
}

// PullQuote, PullquoteUnderline and LeadParagraph carry no attributes beyond
// their inline content.
export type PullQuoteAttrs = Record<string, never>;
export type PullquoteUnderlineAttrs = Record<string, never>;
export type LeadParagraphAttrs = Record<string, never>;

// Section-rule is an atom (no inline content). The label travels as text on
// the attribute and the renderer emits it inside .article-section-tag.
// anchorId becomes the element id so a TOC can deep-link.
export interface SectionRuleAttrs {
  label: string;
  anchorId?: string | null;
}

export type CustomNodeType =
  | 'inlineImage'
  | 'gallery'
  | 'pullQuote'
  | 'pullquoteUnderline'
  | 'sectionRule'
  | 'leadParagraph'
  | 'embed'
  | 'rawHtml';

// Structural model of a Tiptap/ProseMirror JSON document. Optionals carry an
// explicit `| undefined` so the recursive zod schema's inferred output (in
// validators) stays assignable under `exactOptionalPropertyTypes`.
export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown> | undefined;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  content?: TiptapNode[] | undefined;
  marks?: TiptapMark[] | undefined;
  text?: string | undefined;
}

export interface TiptapDoc {
  type: 'doc';
  content?: TiptapNode[] | undefined;
}
