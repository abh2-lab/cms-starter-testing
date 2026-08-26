import type { Block, TemplateMeta } from './types.js';

// Structural guards shared by registry.ts (which builds the runtime registries)
// and themes.ts (which derives the core key sets). Internal — deliberately not
// re-exported from index.ts.
//
// Structural rather than nominal because a module exports whatever it exports:
// export names do not follow the filename (templates/single.ts exports
// `singleArticle`), and a file may export more than one thing. Picking values
// out by shape means nothing has to guess a name.

export function isBlock(value: unknown): value is Block {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { meta?: { key?: unknown }; load?: unknown };
  return (
    typeof v.meta === 'object' &&
    v.meta !== null &&
    typeof v.meta.key === 'string' &&
    typeof v.load === 'function'
  );
}

export function isTemplateMeta(value: unknown): value is TemplateMeta {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { key?: unknown; blocks?: unknown };
  return typeof v.key === 'string' && Array.isArray(v.blocks);
}

/** Every `key` of the matching exports across a group of modules. */
export function keysOf(
  modules: ReadonlyArray<Record<string, unknown>>,
  kind: 'block' | 'template',
): Set<string> {
  const out = new Set<string>();
  for (const mod of modules) {
    for (const value of Object.values(mod)) {
      if (kind === 'block') {
        if (isBlock(value)) out.add(value.meta.key);
      } else if (isTemplateMeta(value)) {
        out.add(value.key);
      }
    }
  }
  return out;
}
