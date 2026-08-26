import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BlockFieldSchema, BlockMetaSchema, BLOCK_KINDS } from '@cms/blocks';
import type { BlockField, BlockKind } from '@cms/blocks';
import type { BlockSpec } from './types.js';
import { renderServerBlock, renderVueComponent } from './codegen.js';
import { upsertInAnchorRegion } from './anchors.js';
import { isValidBlockKey, toBlockComponentName, escapeRegExp } from '../lib/naming.js';
import {
  BLOCKS_DIR,
  THEME_BLOCKS_DIR,
  VUE_REGISTRY_FILE,
  relativeToRepo,
} from '../lib/paths.js';

export interface GenBlockResult {
  ok: boolean;
  key: string;
  written: string[];
  skipped: string[];
}

// Validate + normalize raw input (from --spec / --json / flags) into a BlockSpec.
// The final gate parses the exact meta we will emit through the REAL
// BlockMetaSchema, so gen can never produce a block that verify:theme rejects.
export function normalizeBlockSpec(raw: unknown): BlockSpec {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('block spec must be an object');
  }
  const r = raw as Record<string, unknown>;

  const key = typeof r['key'] === 'string' ? r['key'] : '';
  if (!isValidBlockKey(key)) {
    throw new Error(`invalid block key '${key}' — must match /^[a-z][a-z0-9-]*$/`);
  }

  const kindValue = r['kind'] ?? 'standalone';
  if (typeof kindValue !== 'string') {
    throw new Error(`kind must be a string — one of ${BLOCK_KINDS.join(', ')}`);
  }
  if (!(BLOCK_KINDS as readonly string[]).includes(kindValue)) {
    throw new Error(`invalid kind '${kindValue}' — one of ${BLOCK_KINDS.join(', ')}`);
  }

  const label = typeof r['label'] === 'string' ? r['label'] : '';
  const category = typeof r['category'] === 'string' ? r['category'] : '';

  const spec: BlockSpec = {
    key,
    kind: kindValue as BlockKind,
    label,
    category,
    fields: parseFieldArray(r['fields'], 'fields'),
    options: parseFieldArray(r['options'], 'options'),
    lazy: r['lazy'] === true,
  };
  if (typeof r['description'] === 'string' && r['description']) spec.description = r['description'];
  if (typeof r['icon'] === 'string' && r['icon']) spec.icon = r['icon'];

  // Build the meta EXACTLY as renderServerBlock emits it, then validate.
  const meta: Record<string, unknown> = {
    key: spec.key,
    label: spec.label,
    category: spec.category,
    fields: spec.fields,
    options: spec.options,
  };
  if (spec.description) meta['description'] = spec.description;
  if (spec.icon) meta['icon'] = spec.icon;
  if (spec.kind !== 'standalone') meta['kind'] = spec.kind;
  const parsed = BlockMetaSchema.safeParse(meta);
  if (!parsed.success) {
    throw new Error(
      `block meta failed validation:\n  ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')}`,
    );
  }

  return spec;
}

function parseFieldArray(value: unknown, label: string): BlockField[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((f, i) => {
    const parsed = BlockFieldSchema.safeParse(f);
    if (!parsed.success) {
      throw new Error(
        `${label}[${i}] invalid: ${parsed.error.issues.map((x) => x.message).join('; ')}`,
      );
    }
    return parsed.data;
  });
}

function writeOrSkip(
  path: string,
  content: string,
  force: boolean,
  result: GenBlockResult,
): void {
  if (existsSync(path) && !force) {
    result.skipped.push(relativeToRepo(path));
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  result.written.push(relativeToRepo(path));
}

export function genBlock(spec: BlockSpec, opts: { force: boolean }): GenBlockResult {
  const result: GenBlockResult = { ok: true, key: spec.key, written: [], skipped: [] };
  const componentName = toBlockComponentName(spec.key);
  const keyRe = new RegExp(`'${escapeRegExp(spec.key)}'`);

  // 1) server half — packages/blocks/src/blocks/<key>.ts (skip if hand-edited).
  writeOrSkip(join(BLOCKS_DIR, `${spec.key}.ts`), renderServerBlock(spec), opts.force, result);

  // 2) render half — theme components/blocks/Block<Pascal>.vue (skip if hand-edited).
  writeOrSkip(
    join(THEME_BLOCKS_DIR, `${componentName}.vue`),
    renderVueComponent(spec),
    opts.force,
    result,
  );

  // 3) server registry — nothing to do here any more. registry.ts is built
  //    from a scan of src/blocks/, so writing the file in step 1 IS the
  //    registration. This used to splice an import line and a Map entry into
  //    registry.ts via anchor regions, which made that one shared core file
  //    the thing every new block had to edit — exactly what would conflict
  //    when a core update met a publisher's own blocks.
  //    See docs/phase-3-versioning-and-updates-plan.md.

  // 4) Vue registry — eager import + Map entry, or a single-line lazy entry.
  let vueReg = readFileSync(VUE_REGISTRY_FILE, 'utf8');
  if (spec.lazy) {
    vueReg = upsertInAnchorRegion(
      vueReg,
      'block-registry',
      keyRe,
      `  '${spec.key}': defineAsyncComponent(() => import('~/components/blocks/${componentName}.vue')) as Component,`,
    );
  } else {
    vueReg = upsertInAnchorRegion(
      vueReg,
      'block-imports',
      new RegExp(`\\b${componentName}\\b`),
      `import ${componentName} from '~/components/blocks/${componentName}.vue';`,
    );
    vueReg = upsertInAnchorRegion(
      vueReg,
      'block-registry',
      keyRe,
      `  '${spec.key}': ${componentName} as Component,`,
    );
  }
  writeFileSync(VUE_REGISTRY_FILE, vueReg, 'utf8');
  result.written.push(relativeToRepo(VUE_REGISTRY_FILE));

  return result;
}
