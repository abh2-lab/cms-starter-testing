import type { Block } from '../types.js';

// custom-field — a generic FIELD block. Renders ONE custom field of the current
// post, chosen from a dropdown of the ancestor box's content-type fields (the
// admin picker resolves that list; here we just read the stored key). Works for
// ANY content type — the hard-coded field blocks (post-title, post-author, …)
// cover the common cases; this one covers everything else (an Author's role,
// bio, headshot, social handles, …) without a bespoke block per field.
//
// Box handling mirrors post-content: a 'detail' box already carries
// customFields; a 'summary' box (a query-loop item) hydrates THIS row on demand
// (budget-capped by the composer). The field's declared TYPE is resolved via
// ctx.contentTypeField so the renderer can format rich text / media / scalars
// correctly; media keys are resolved to URLs here so the component just renders.

interface CustomFieldOptions {
  field_key?: string;
}

export const customField: Block<Record<string, unknown>, CustomFieldOptions> = {
  meta: {
    key: 'custom-field',
    label: 'Custom Field',
    category: 'fields',
    description:
      "Renders a chosen custom field from the current post's content type (any field, any type).",
    icon: 'tag',
    kind: 'field',
    fields: [],
    options: [
      {
        key: 'field_key',
        label: 'Field',
        type: 'custom_field',
        required: true,
        helpText:
          "Pick a custom field from the surrounding box's content type.",
      },
    ],
  },
  async load(ctx, { options }) {
    const box = ctx.box;
    const fieldKey =
      typeof options.field_key === 'string' && options.field_key.length > 0
        ? options.field_key
        : '';
    const empty: Record<string, unknown> = {
      value: null,
      fieldType: null,
      label: null,
    };
    if (!box || !fieldKey) return empty;

    const detail = box.kind === 'detail' ? box.detail : await box.hydrate?.();
    if (!detail) return empty;

    const raw = detail.customFields[fieldKey] ?? null;
    const def = (await ctx.contentTypeField?.(box.content.type, fieldKey)) ?? null;
    const fieldType = def?.type ?? null;
    const label = def?.label ?? null;

    // Media fields store a key/ref — resolve to a public URL for the renderer.
    if (fieldType === 'media_single' && raw != null) {
      const url = (await ctx.resolveMediaUrl?.(raw)) ?? null;
      return { value: url, fieldType, label };
    }
    if (fieldType === 'media_gallery' && Array.isArray(raw)) {
      const urls = await Promise.all(
        raw.map((r) => ctx.resolveMediaUrl?.(r) ?? Promise.resolve(null)),
      );
      return { value: urls.filter((u): u is string => !!u), fieldType, label };
    }

    return { value: raw, fieldType, label };
  },
};
