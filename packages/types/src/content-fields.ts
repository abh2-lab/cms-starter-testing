import { z } from 'zod';

// The 14 user-facing field types a content_type can declare. Adding a type
// here means updating: the runtime validator (apps/api content-validator),
// the admin field renderer (CustomFieldsEditor.vue), and the builder UI.
export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'rich_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'media_single',
  'media_gallery',
  'taxonomy_relation',
  'content_relation',
  'select',
  'repeater',
  'json_raw',
] as const;

export const FieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof FieldTypeSchema>;

// System columns on the content row — never allowed as custom field names.
// Enforced in the field builder (client) and the content-types API (server).
export const RESERVED_FIELD_NAMES = [
  'id',
  'slug',
  'status',
  'created_at',
  'updated_at',
  'published_at',
  'author_id',
  'content_type_id',
] as const;

// Type-specific validation rules. Each field type reads the subset it cares
// about (e.g. short_text → min/maxLength, number → min/max, select → options).
export const FieldValidationsSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(z.string()).optional(),
  })
  .optional();

export type FieldValidations = z.infer<typeof FieldValidationsSchema>;

// Sub-fields available inside a repeater. A deliberately small primitive set —
// repeaters don't nest media/relations/repeaters (avoids unbounded recursion
// and keeps the row editor simple).
export const SUB_FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'boolean',
  'date',
  'select',
] as const;

export const SubFieldTypeSchema = z.enum(SUB_FIELD_TYPES);
export type SubFieldType = z.infer<typeof SubFieldTypeSchema>;

// One column within a repeater row. `options` applies to the select type.
export const SubFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier'),
  label: z.string().min(1),
  type: SubFieldTypeSchema,
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

export type SubFieldDefinition = z.infer<typeof SubFieldDefinitionSchema>;

// A single field within a content_type's field_definitions.fields array.
export const FieldDefinitionSchema = z.object({
  // Stable id generated when the field is added (used for reordering/edits).
  id: z.string().uuid(),
  // Machine name (snake_case) — the key under which the value is stored in
  // content.custom_fields. Immutable once content entries exist.
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier'),
  label: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean(),
  helpText: z.string().optional(),
  order: z.number().int(),
  validations: FieldValidationsSchema,
  default: z.unknown().optional(),
  // Only meaningful when type === 'repeater': the columns of each row.
  subFields: z.array(SubFieldDefinitionSchema).optional(),
});

export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

// The wrapper object stored in content_types.field_definitions (JSONB).
// Field names must be unique and must not collide with reserved names.
export const FieldDefinitionsSchema = z.object({
  fields: z.array(FieldDefinitionSchema).superRefine((fields, ctx) => {
    const seen = new Set<string>();
    const reserved = RESERVED_FIELD_NAMES as readonly string[];
    for (const f of fields) {
      if (reserved.includes(f.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${f.name}" is a reserved field name`,
          path: [f.name],
        });
      }
      if (seen.has(f.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate field name "${f.name}"`,
          path: [f.name],
        });
      }
      seen.add(f.name);
    }
  }),
});

export type FieldDefinitions = z.infer<typeof FieldDefinitionsSchema>;
