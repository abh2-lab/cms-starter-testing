import { z } from 'zod';
import type { FieldDefinition } from '@cms/types';
import { bodySchema } from '@cms/editor/validators';

// Field types whose stored value is an array (vs. a scalar).
const ARRAY_FIELD_TYPES = new Set<FieldDefinition['type']>([
  'media_gallery',
  'taxonomy_relation',
  'content_relation',
  'repeater',
]);

// Per-field Zod schema derived from a field definition + its validations.
function fieldSchema(f: FieldDefinition): z.ZodTypeAny {
  const v = f.validations ?? {};
  switch (f.type) {
    case 'short_text':
    case 'long_text': {
      let s = z.string();
      if (typeof v.minLength === 'number') s = s.min(v.minLength);
      if (typeof v.maxLength === 'number') s = s.max(v.maxLength);
      return s;
    }
    case 'number': {
      let n = z.number();
      if (typeof v.min === 'number') n = n.min(v.min);
      if (typeof v.max === 'number') n = n.max(v.max);
      return n;
    }
    case 'boolean':
      return z.boolean();
    case 'date':
    case 'datetime':
      return z.string().min(1);
    case 'media_single':
      // A media reference can be any of three shapes that `objectUrl()` in
      // apps/api/src/lib/s3.ts already accepts:
      //   1. A media row UUID (what the admin MediaField emits on upload)
      //   2. An S3 storage key (tenant-uuid prefixed, from buildStorageKey)
      //   3. An absolute http(s) URL (placeholders from seed-examples, or
      //      externally-hosted assets)
      // The previous z.string().uuid() rejected (2) and (3), which surfaced
      // as save-draft 422s for any post with a seeded hero image. Validation
      // that the referenced media row exists is a downstream concern; here
      // we only enforce "non-empty string."
      return z.string().min(1);
    case 'media_gallery':
      return z.array(z.string().min(1));
    case 'taxonomy_relation':
    case 'content_relation':
      // Relations are always FK-shaped references to in-DB rows — keep the
      // strict UUID check so a typo doesn't get to the FK validator.
      return z.array(z.string().uuid());
    case 'select': {
      const opts = v.options ?? [];
      return opts.length > 0
        ? z.enum(opts as [string, ...string[]])
        : z.string();
    }
    case 'repeater':
      return z.array(z.unknown());
    case 'rich_text':
      // Tiptap body doc — structural + image-mediaId rules enforced centrally
      // by @cms/editor so invalid bodies are rejected before they're stored.
      return bodySchema;
    case 'json_raw':
    default:
      return z.unknown();
  }
}

// Empty string / null are treated as "field not provided" so a half-finished
// draft doesn't trip type or required checks. Empty arrays are left as-is so
// the required-array `.min(1)` check below can reject them at publish time.
function emptyToUndefined(value: unknown): unknown {
  return value === '' || value === null ? undefined : value;
}

interface BuildOptions {
  // Draft mode: every field is optional and empty values are skipped, but any
  // value that IS supplied must still match its type/format. Used on create
  // and PATCH so an author can save an incomplete draft. When false (publish
  // mode) the field's `required` flag is enforced — used to gate transitions
  // into a publicly-visible status.
  partial?: boolean;
}

// Build a Zod object schema that validates a content.custom_fields payload
// against a content type's field definitions. Unknown keys are stripped from
// the parsed result.
export function buildContentDataSchema(
  fields: FieldDefinition[],
  options: BuildOptions = {},
): z.ZodTypeAny {
  const partial = options.partial ?? false;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    const base = fieldSchema(f);
    if (partial || !f.required) {
      shape[f.name] = z.preprocess(emptyToUndefined, base.optional());
    } else {
      // Required + publish mode: a missing/empty value must fail. For array
      // types, an empty array must fail too.
      const required = ARRAY_FIELD_TYPES.has(f.type)
        ? (base as z.ZodArray<z.ZodTypeAny>).min(1)
        : base;
      shape[f.name] = z.preprocess(emptyToUndefined, required);
    }
  }
  return z.object(shape);
}
