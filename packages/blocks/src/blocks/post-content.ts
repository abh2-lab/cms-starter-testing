import type { Block } from '../types.js';

// post-content — a FIELD block that renders the current post's rich-text body.
// The body STAYS in TipTap: this block only delivers the stored TipTap JSON to
// the renderer, which wraps the existing renderTiptap() util. By convention the
// body lives at custom_fields.body, but the `field_name` option lets a content
// type that stores rich text under a different key point at it.
//
// Box handling: a 'detail' box (the single-article route) already carries
// customFields, so no extra query. A 'summary' box (a query-loop item) is lean,
// so we hydrate THIS row on demand via box.hydrate() (the composer caps how
// many hydrate per request); when the budget is spent hydrate() returns null
// and the body renders empty.

interface PostContentOptions {
  field_name?: string;
}

export const postContent: Block<Record<string, unknown>, PostContentOptions> = {
  meta: {
    key: 'post-content',
    label: 'Post Content',
    category: 'fields',
    description:
      'Renders the current post rich-text body (TipTap). Reads custom_fields.body by default.',
    icon: 'file-text',
    kind: 'field',
    fields: [],
    options: [
      {
        key: 'field_name',
        label: 'Body field name',
        type: 'short_text',
        default: 'body',
        helpText:
          'The custom-field key holding the rich-text body. Defaults to "body".',
      },
    ],
  },
  async load(ctx, { options }) {
    const box = ctx.box;
    if (!box) return { body: null };
    const fieldName =
      typeof options.field_name === 'string' && options.field_name.length > 0
        ? options.field_name
        : 'body';
    const detail = box.kind === 'detail' ? box.detail : await box.hydrate?.();
    return { body: detail ? detail.customFields[fieldName] ?? null : null };
  },
};
