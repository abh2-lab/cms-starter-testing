import type { BlockField } from '@cms/blocks';

// Emit a single-quoted TS string literal, escaping backslashes / quotes / newlines
// so the generated source is valid and eslint-clean (the repo is single-quote and
// has no Prettier gate — see the plan's "never prettier --write" rule).
export function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

// The TS type a BlockField maps to in a generated Fields/Options interface.
export function fieldTsType(field: BlockField): string {
  switch (field.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'kv_list':
      return 'Array<{ label: string; value: string }>';
    default:
      return 'string';
  }
}

// Serialize a JSON-ish default value to a TS literal.
export function serializeValue(value: unknown): string {
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((v) => serializeValue(v)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) =>
        `${/^[a-z][a-z0-9_]*$/i.test(k) ? k : quote(k)}: ${serializeValue(v)}`,
    );
    return `{ ${entries.join(', ')} }`;
  }
  return 'undefined';
}

// Serialize a BlockField to a TS object-literal entry, indented by `indent`,
// emitting only the keys that are present in a stable order.
export function serializeField(field: BlockField, indent: string): string {
  const inner = indent + '  ';
  const lines: string[] = [`${indent}{`];
  lines.push(`${inner}key: ${quote(field.key)},`);
  lines.push(`${inner}label: ${quote(field.label)},`);
  lines.push(`${inner}type: ${quote(field.type)},`);
  if (field.required !== undefined) lines.push(`${inner}required: ${String(field.required)},`);
  if (field.default !== undefined) lines.push(`${inner}default: ${serializeValue(field.default)},`);
  if (field.helpText !== undefined) lines.push(`${inner}helpText: ${quote(field.helpText)},`);
  if (field.options !== undefined) {
    lines.push(`${inner}options: [${field.options.map((o) => quote(o)).join(', ')}],`);
  }
  if (field.contentTypeSlug !== undefined) {
    lines.push(`${inner}contentTypeSlug: ${quote(field.contentTypeSlug)},`);
  }
  if (field.taxonomySlug !== undefined) {
    lines.push(`${inner}taxonomySlug: ${quote(field.taxonomySlug)},`);
  }
  if (field.min !== undefined) lines.push(`${inner}min: ${String(field.min)},`);
  if (field.max !== undefined) lines.push(`${inner}max: ${String(field.max)},`);
  lines.push(`${indent}},`);
  return lines.join('\n');
}

// Serialize an array of BlockFields as a TS array literal at the given indent
// (the indent of the `fields:`/`options:` key the array is assigned to).
export function serializeFieldArray(fields: BlockField[], indent: string): string {
  if (fields.length === 0) return '[]';
  const items = fields.map((f) => serializeField(f, indent + '  ')).join('\n');
  return `[\n${items}\n${indent}]`;
}
