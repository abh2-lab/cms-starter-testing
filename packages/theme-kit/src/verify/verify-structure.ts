import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { blockRegistry, BlockMetaSchema, TemplateMetaSchema } from '@cms/blocks';
import { THEME_BLOCKS_DIR, CORE_THEME_BLOCKS_DIR, VUE_REGISTRY_FILE, relativeToRepo } from '../lib/paths.js';
import { toBlockComponentName } from '../lib/naming.js';
import { makeStubContext, defaultsFrom } from './stub-ctx.js';
import { allParts, allTemplates, collectBlockKeys, parseVueRegistryKeys } from './sources.js';

const PART_ROLES = ['header', 'footer', 'sidebar'];

export interface Finding {
  key?: string;
  file?: string;
  message: string;
  fix: string;
}

export interface CheckResult {
  check: string;
  status: 'pass' | 'fail';
  findings: Finding[];
}

export interface VerifyReport {
  ok: boolean;
  checks: CheckResult[];
}

// 1) Every block meta + template/part meta satisfies the real schema.
function checkMetas(): Finding[] {
  const findings: Finding[] = [];
  for (const block of blockRegistry.values()) {
    const parsed = BlockMetaSchema.safeParse(block.meta);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        findings.push({
          key: block.meta.key,
          message: `block meta invalid — ${issue.path.join('.')}: ${issue.message}`,
          fix: `fix the meta in packages/blocks/src/blocks/${block.meta.key}.ts`,
        });
      }
    }
  }
  for (const tpl of [...allTemplates(), ...allParts()]) {
    const parsed = TemplateMetaSchema.safeParse(tpl);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        findings.push({
          key: tpl.key,
          message: `template/part meta invalid — ${issue.path.join('.')}: ${issue.message}`,
          fix: `fix the meta in packages/blocks/src/{templates,parts}/${tpl.key}.ts`,
        });
      }
    }
  }
  return findings;
}

// 2) The #1 silent gotcha: server block key ↔ Vue component, both directions;
//    every template/part block_key exists; parts use only part roles.
function checkCoherence(): Finding[] {
  const findings: Finding[] = [];
  const serverKeys = new Set(blockRegistry.keys());
  const vueKeys = new Set(parseVueRegistryKeys());

  for (const key of serverKeys) {
    if (!vueKeys.has(key)) {
      findings.push({
        key,
        file: relativeToRepo(VUE_REGISTRY_FILE),
        message: `server block '${key}' has no entry in the theme BLOCK_REGISTRY → renders blank`,
        fix: `add it to useBlockRegistry.ts, or re-run \`pnpm gen:block --key ${key} ...\``,
      });
    }
    // The render half lives in core for a core block and in the theme layer
    // for a theme block; either satisfies the pairing.
    const vueName = `${toBlockComponentName(key)}.vue`;
    const vuePath = join(THEME_BLOCKS_DIR, vueName);
    const coreVuePath = join(CORE_THEME_BLOCKS_DIR, vueName);
    if (!existsSync(vuePath) && !existsSync(coreVuePath)) {
      findings.push({
        key,
        file: relativeToRepo(vuePath),
        message: `server block '${key}' has no .vue render half`,
        fix: `create ${toBlockComponentName(key)}.vue (or re-run gen:block)`,
      });
    }
  }
  for (const key of vueKeys) {
    if (!serverKeys.has(key)) {
      findings.push({
        key,
        file: relativeToRepo(VUE_REGISTRY_FILE),
        message: `theme BLOCK_REGISTRY has '${key}' but no server block defines it`,
        fix: `add the server block in packages/blocks, or remove the Vue entry`,
      });
    }
  }
  for (const tpl of allTemplates()) {
    const keys = new Set<string>();
    collectBlockKeys(tpl.blocks, keys);
    for (const k of keys) {
      if (!serverKeys.has(k)) {
        findings.push({
          key: k,
          message: `template '${tpl.key}' references unknown block '${k}'`,
          fix: `generate the block first, or fix the block_key in the template`,
        });
      }
    }
  }
  for (const part of allParts()) {
    const keys = new Set<string>();
    collectBlockKeys(part.blocks, keys);
    for (const k of keys) {
      if (!serverKeys.has(k)) {
        findings.push({
          key: k,
          message: `part '${part.key}' references unknown block '${k}'`,
          fix: `generate the block first, or fix the block_key in the part`,
        });
      }
    }
    if (part.role !== undefined && !PART_ROLES.includes(part.role)) {
      findings.push({
        key: part.key,
        message: `part '${part.key}' has role '${part.role}' — parts must be header|footer|sidebar`,
        fix: `set a part role, or move it to packages/blocks/src/templates if it's a page template`,
      });
    }
  }
  return findings;
}

// 4) Serverless render-smoke: run every loader against the stub ctx. Catches
//    loaders that throw. NOTE: this exercises load()/resolveBoxes(), it does NOT
//    mount the .vue — runtime template errors surface only in the hybrid preview.
async function checkRenderSmoke(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const ctx = makeStubContext();
  for (const block of blockRegistry.values()) {
    const args = {
      fields: defaultsFrom(block.meta.fields),
      options: defaultsFrom(block.meta.options),
    };
    try {
      const data = await block.load(ctx, args);
      if (data !== null && typeof data !== 'object') {
        findings.push({
          key: block.meta.key,
          message: `load() returned ${typeof data} — must be an object or null`,
          fix: `return a data object (or null) from load()`,
        });
      }
    } catch (err) {
      findings.push({
        key: block.meta.key,
        message: `load() threw on stub data: ${(err as Error).message}`,
        fix: `guard load() against missing/empty data (it runs before content exists)`,
      });
    }
    if (block.meta.kind === 'box' && block.resolveBoxes) {
      try {
        const boxes = await block.resolveBoxes(ctx, args);
        if (!Array.isArray(boxes)) {
          findings.push({
            key: block.meta.key,
            message: `resolveBoxes() did not return an array`,
            fix: `return PostBox[] from resolveBoxes()`,
          });
        }
      } catch (err) {
        findings.push({
          key: block.meta.key,
          message: `resolveBoxes() threw on stub data: ${(err as Error).message}`,
          fix: `guard resolveBoxes() against missing selectors`,
        });
      }
    }
  }
  return findings;
}

export async function verifyStructure(): Promise<VerifyReport> {
  const checks: CheckResult[] = [];
  const run = (check: string, findings: Finding[]): void => {
    checks.push({
      check,
      status: findings.length === 0 ? 'pass' : 'fail',
      findings: findings.map((f) => ({ ...f })),
    });
  };

  run('metas', checkMetas());
  run('registry-coherence', checkCoherence());
  run('render-smoke', await checkRenderSmoke());

  return { ok: checks.every((c) => c.status === 'pass'), checks };
}
