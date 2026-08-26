import { z } from 'zod';
import type { TiptapNode } from '../types/index.js';

// Per-custom-node attribute schemas. The image rule is the load-bearing one:
// `mediaId` is a required UUID and there is no `src`/URL field, enforcing the
// "store a mediaId, never a URL" architecture rule at the API boundary.
export const inlineImageAttrsSchema = z.object({
  mediaId: z.string().uuid(),
  caption: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  width: z.enum(['full', 'half', 'constrained']).default('full'),
  float: z.enum(['left', 'right']).nullable().default(null),
});

export const galleryAttrsSchema = z.object({
  mediaIds: z.array(z.string().uuid()),
  layout: z.enum(['grid', 'slider', 'masonry']).default('grid'),
  caption: z.string().nullable().optional(),
});

const EMBED_MODES = ['link', 'iframe', 'card'] as const;

// Mirrors EmbedAttrs in ../types. `value` is intentionally NOT `.url()`: in
// iframe mode it carries raw embed code, and an empty value is valid for a
// freshly-inserted block (the old `url: z.string().url()` rejected that, which
// 422'd drafts). Legacy {url, provider} keys are tolerated so pre-existing
// bodies still validate; the renderer + editor read them via fallback.
export const embedAttrsSchema = z.object({
  type: z.enum(EMBED_MODES).default('link'),
  value: z.string().default(''),
  caption: z.string().nullable().optional(),
  url: z.string().optional(),
  provider: z.string().optional(),
});

export const rawHtmlAttrsSchema = z.object({
  html: z.string(),
});

// Section-rule: small kicker label + horizontal divider. Atom node — no inline
// content; the label travels as an attribute. anchorId is optional and becomes
// the rendered element id when set so editors can link to the section from a
// TOC. Both fields are length-bounded so a stray paste can't ship a 10k label.
export const sectionRuleAttrsSchema = z.object({
  label: z.string().min(1).max(120),
  anchorId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, 'anchorId must be slug-shaped')
    .nullable()
    .optional(),
});

// Allow-lists. Adding a node/mark type means updating the matching set here as
// well as the extensions and types — unknown types are rejected by design.
const STANDARD_NODE_TYPES = new Set<string>([
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
]);

const CUSTOM_NODE_TYPES = new Set<string>([
  'inlineImage',
  'gallery',
  'pullQuote',
  'pullquoteUnderline',
  'sectionRule',
  'leadParagraph',
  'embed',
  'rawHtml',
]);

const CUSTOM_ATTR_SCHEMAS: Record<string, z.ZodTypeAny> = {
  inlineImage: inlineImageAttrsSchema,
  gallery: galleryAttrsSchema,
  embed: embedAttrsSchema,
  rawHtml: rawHtmlAttrsSchema,
  sectionRule: sectionRuleAttrsSchema,
};

const KNOWN_MARK_TYPES = new Set<string>([
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'underline',
  'textStyle',
  // The Color extension stores its value on the textStyle mark, but older docs
  // (and some serializers) may carry a discrete `color` mark — accept both so
  // coloured text round-trips through the API boundary instead of 422-ing.
  'color',
]);

const markSchema = z
  .object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((mark, ctx) => {
    if (!KNOWN_MARK_TYPES.has(mark.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown mark type "${mark.type}"`,
        path: ['type'],
      });
      return;
    }
    if (mark.type === 'link') {
      const href = mark.attrs?.['href'];
      if (typeof href !== 'string' || href.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'link mark requires a non-empty href',
          path: ['attrs', 'href'],
        });
      }
    }
  });

/**
 * Recursive node validator. Rejects unknown node types, requires a `text`
 * string on text nodes, and runs the matching strict attr schema for custom
 * nodes (re-pathing any issues under `attrs`). Standard nodes are validated
 * structurally and may carry arbitrary attrs.
 */
export const nodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z
    .object({
      type: z.string(),
      attrs: z.record(z.string(), z.unknown()).optional(),
      content: z.array(nodeSchema).optional(),
      marks: z.array(markSchema).optional(),
      text: z.string().optional(),
    })
    .superRefine((node, ctx) => {
      if (!STANDARD_NODE_TYPES.has(node.type) && !CUSTOM_NODE_TYPES.has(node.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown node type "${node.type}"`,
          path: ['type'],
        });
        return;
      }
      if (node.type === 'text' && typeof node.text !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'text node requires a text string',
          path: ['text'],
        });
      }
      const attrSchema = CUSTOM_ATTR_SCHEMAS[node.type];
      if (attrSchema) {
        const result = attrSchema.safeParse(node.attrs ?? {});
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: issue.message,
              path: ['attrs', ...issue.path],
            });
          }
        }
      }
    }),
);

/**
 * Validates a complete Tiptap body document. Use at the API boundary to reject
 * malformed JSON before it is persisted to the content row.
 */
export const bodySchema = z.object({
  type: z.literal('doc'),
  content: z.array(nodeSchema).optional(),
});
