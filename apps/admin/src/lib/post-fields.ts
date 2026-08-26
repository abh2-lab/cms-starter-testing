import type { FieldDefinition, FieldDefinitions } from '@/api/content-types';

/**
 * Resolves which custom fields the post editor surfaces in dedicated mockup
 * positions (body / excerpt / featured image) versus the generic Custom Fields
 * section. This is a presentation convention only — every field's VALUE still
 * lives in the content row's `customFields` map, so the existing save path is
 * unchanged. When a convention field is absent the corresponding editor element
 * hides; `null` (not `undefined`) is returned for clean template `v-if` guards.
 */
export interface ResolvedPostFields {
  bodyField: FieldDefinition | null;
  excerptField: FieldDefinition | null;
  featuredImageField: FieldDefinition | null;
  rest: FieldDefinition[];
}

const EXCERPT_NAMES = ['excerpt', 'summary'];
const FEATURED_IMAGE_NAMES = ['featured_image', 'hero', 'featured'];

export function resolvePostFields(
  defs: FieldDefinitions | null | undefined,
): ResolvedPostFields {
  const fields = [...(defs?.fields ?? [])].sort((a, b) => a.order - b.order);

  // Body: prefer a rich_text field literally named "body", else the first
  // rich_text field. Any other rich_text fields stay in `rest`.
  const bodyField =
    fields.find(
      (f) => f.type === 'rich_text' && f.name.toLowerCase() === 'body',
    ) ??
    fields.find((f) => f.type === 'rich_text') ??
    null;

  // Excerpt: first long_text/short_text named excerpt or summary.
  const excerptField =
    fields.find(
      (f) =>
        (f.type === 'long_text' || f.type === 'short_text') &&
        EXCERPT_NAMES.includes(f.name.toLowerCase()),
    ) ?? null;

  // Featured image: first media_single named featured_image / hero / featured.
  // The media_single guard avoids matching a boolean field like `is_featured`.
  const featuredImageField =
    fields.find(
      (f) =>
        f.type === 'media_single' &&
        FEATURED_IMAGE_NAMES.includes(f.name.toLowerCase()),
    ) ?? null;

  const pulled = new Set<string>();
  if (bodyField) pulled.add(bodyField.name);
  if (excerptField) pulled.add(excerptField.name);
  if (featuredImageField) pulled.add(featuredImageField.name);

  const rest = fields.filter((f) => !pulled.has(f.name));

  return { bodyField, excerptField, featuredImageField, rest };
}
