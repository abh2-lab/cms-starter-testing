import type { FieldDefinitions } from '@cms/types';

export function slugifySiteName(name: string): string {
  const stem = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem || 'cms';
}

export function formatSubmissionAccess(
  level: 'none' | 'authenticated' | 'public',
): string {
  switch (level) {
    case 'none':
      return 'closed';
    case 'authenticated':
      return 'authenticated users only';
    case 'public':
      return 'anyone (anonymous)';
  }
}

// Wrap a value in backticks safely. If the value itself contains a backtick,
// fall back to a double-backtick fence (CommonMark behaviour).
export function code(value: string): string {
  if (!value.includes('`')) return `\`${value}\``;
  return `\`\` ${value} \`\``;
}

// Renders a per-content-type fields table (readable mode only). Returns an
// empty string when the type has no custom fields declared.
export function renderFieldsTable(defs: FieldDefinitions): string {
  if (!defs.fields || defs.fields.length === 0) return '';
  const rows: string[] = [];
  rows.push('| Field | Type | Required | Notes |');
  rows.push('| --- | --- | --- | --- |');
  for (const f of defs.fields) {
    const required = f.required ? 'yes' : 'no';
    const notes = (f.helpText ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    rows.push(`| ${code(f.name)} | ${code(f.type)} | ${required} | ${notes} |`);
  }
  return rows.join('\n');
}
