// Key/name conversions shared by the gen commands. Block + template keys are
// lowercase-dashed (e.g. 'author-card'); the matching server const is camelCase
// (authorCard) and the Vue component is PascalCase with a Block prefix
// (BlockAuthorCard). Centralised so the server half, render half, and BOTH
// registry entries can never disagree on a name.

export function toCamelCase(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export function toPascalCase(key: string): string {
  const camel = toCamelCase(key);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

// The Vue component name for a block key: BlockAuthorCard for 'author-card'.
export function toBlockComponentName(key: string): string {
  return `Block${toPascalCase(key)}`;
}

// Block keys + template/part keys: lowercase-dashed (mirrors BlockMetaSchema /
// TemplateMetaSchema in @cms/blocks).
export function isValidBlockKey(key: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(key);
}

// Field/option keys: snake_case (mirrors BlockFieldSchema in @cms/blocks).
export function isValidFieldKey(key: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(key);
}

// Escape a string for safe interpolation into a `new RegExp(...)` pattern.
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
