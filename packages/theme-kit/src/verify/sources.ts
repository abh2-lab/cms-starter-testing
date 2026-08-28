import { readFileSync, existsSync } from 'node:fs';
import {
  getTemplatesByRole,
  partRegistry,
  templateRegistry,
  TEMPLATE_ROLES,
} from '@cms/blocks';
import type { TemplateBlock, TemplateMeta } from '@cms/blocks';
import { ALL_VUE_REGISTRY_FILES, CORE_VUE_REGISTRY_FILE } from '../lib/paths.js';

// Extract the block_key set from the theme's hand-maintained `BLOCK_REGISTRY`
// map by parsing the source text. The map can't be imported (it pulls Vue +
// `~/`-aliased .vue files that only resolve inside Nuxt), so verify reads the
// keys textually — every entry's key is the first token on its line, either
// 'quoted-dashed' or a bareword (hero, group, post).
/**
 * Block keys registered in EITHER layer's Vue registry.
 *
 * Renderers are split: core (themes/default) owns the 39 that ship to every
 * publisher, the theme layer owns its own. A block is correctly wired if
 * either registry names it, so checking one layer alone reports every block
 * from the other as missing.
 */
export function parseVueRegistryKeys(): string[] {
  return [
    ...parseOneRegistry(CORE_VUE_REGISTRY_FILE),
    ...ALL_VUE_REGISTRY_FILES.flatMap(parseOneRegistry),
  ];
}

function parseOneRegistry(file: string): string[] {
  // A theme layer need not have its own registry: themes/basic only re-skins
  // core's blocks, and the active theme may be core itself. Missing is normal,
  // not an error — treating it as one failed the web image build for every
  // publisher, because the starter export excludes custom themes.
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf8');
  const start = content.indexOf('export const BLOCK_REGISTRY');
  if (start === -1) {
    throw new Error(`theme-kit: could not find \`export const BLOCK_REGISTRY\` in ${file}`);
  }
  const braceIdx = content.indexOf('{', start);
  const endIdx = content.indexOf('\n};', braceIdx);
  if (braceIdx === -1 || endIdx === -1) {
    throw new Error('theme-kit: could not locate the BLOCK_REGISTRY object body');
  }
  const body = content.slice(braceIdx + 1, endIdx);

  const keys: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('//')) continue;
    const match = /^(?:'([a-z][a-z0-9-]*)'|([a-z][a-z0-9-]*))\s*:/.exec(trimmed);
    if (match) {
      const key = match[1] ?? match[2];
      if (key) keys.push(key);
    }
  }
  return keys;
}

// All templates the engine knows: the admin page-template set PLUS every
// role-resolved template (single/archive/search/…), deduped by key.
export function allTemplates(): TemplateMeta[] {
  const byKey = new Map<string, TemplateMeta>();
  for (const t of templateRegistry.values()) byKey.set(t.key, t);
  for (const role of TEMPLATE_ROLES) {
    for (const t of getTemplatesByRole(role)) byKey.set(t.key, t);
  }
  return [...byKey.values()];
}

export function allParts(): TemplateMeta[] {
  return [...partRegistry.values()];
}

// Every block_key referenced anywhere in a template/part tree (recursively).
export function collectBlockKeys(blocks: TemplateBlock[], acc: Set<string>): void {
  for (const block of blocks) {
    acc.add(block.block_key);
    if (block.children) collectBlockKeys(block.children, acc);
  }
}
