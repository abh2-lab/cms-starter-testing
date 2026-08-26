import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TemplateBlockSchema, TemplateMetaSchema, TEMPLATE_ROLES } from '@cms/blocks';
import type { TemplateBlock, TemplateRole } from '@cms/blocks';
import type { TemplateSpec } from './types.js';
import { renderTemplate } from './codegen-template.js';
import { isValidBlockKey } from '../lib/naming.js';
import {
  PARTS_DIR,
  TEMPLATES_DIR,
  relativeToRepo,
} from '../lib/paths.js';

const PART_ROLES: readonly TemplateRole[] = ['header', 'footer', 'sidebar'];

export interface GenTemplateResult {
  ok: boolean;
  key: string;
  target: 'page-template' | 'part' | 'role-template';
  written: string[];
  skipped: string[];
  notes: string[];
}

export function normalizeTemplateSpec(raw: unknown): TemplateSpec {
  if (typeof raw !== 'object' || raw === null) throw new Error('template spec must be an object');
  const r = raw as Record<string, unknown>;

  const key = typeof r['key'] === 'string' ? r['key'] : '';
  if (!isValidBlockKey(key)) {
    throw new Error(`invalid template key '${key}' — must match /^[a-z][a-z0-9-]*$/`);
  }
  const name = typeof r['name'] === 'string' ? r['name'] : '';

  let role: TemplateRole | undefined;
  const roleRaw = r['role'];
  if (roleRaw !== undefined) {
    if (typeof roleRaw !== 'string') {
      throw new Error(`role must be a string — one of ${TEMPLATE_ROLES.join(', ')}`);
    }
    if (!(TEMPLATE_ROLES as readonly string[]).includes(roleRaw)) {
      throw new Error(`invalid role '${roleRaw}' — one of ${TEMPLATE_ROLES.join(', ')}`);
    }
    role = roleRaw as TemplateRole;
  }

  const versionRaw = r['version'];
  const version =
    typeof versionRaw === 'number' && Number.isInteger(versionRaw) && versionRaw >= 1
      ? versionRaw
      : 1;

  const blocks = parseTemplateBlocks(r['blocks']);

  const spec: TemplateSpec = { key, name, version, blocks };
  if (typeof r['description'] === 'string' && r['description']) spec.description = r['description'];
  if (typeof r['previewImage'] === 'string' && r['previewImage']) spec.previewImage = r['previewImage'];
  if (role !== undefined) spec.role = role;

  // Validate the exact meta we will emit.
  const meta: Record<string, unknown> = { key, name, version, blocks };
  if (spec.description) meta['description'] = spec.description;
  if (spec.previewImage) meta['previewImage'] = spec.previewImage;
  if (spec.role) meta['role'] = spec.role;
  const parsed = TemplateMetaSchema.safeParse(meta);
  if (!parsed.success) {
    throw new Error(
      `template meta failed validation:\n  ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')}`,
    );
  }
  return spec;
}

function parseTemplateBlocks(value: unknown): TemplateBlock[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('blocks must be an array');
  return value.map((b, i) => {
    const parsed = TemplateBlockSchema.safeParse(b);
    if (!parsed.success) {
      throw new Error(
        `blocks[${i}] invalid: ${parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`,
      );
    }
    return parsed.data;
  });
}

export function genTemplate(spec: TemplateSpec, opts: { force: boolean }): GenTemplateResult {
  const isPart = spec.role !== undefined && PART_ROLES.includes(spec.role);
  const isRole = !isPart && spec.role !== undefined;
  const target: GenTemplateResult['target'] = isPart
    ? 'part'
    : isRole
      ? 'role-template'
      : 'page-template';
  const result: GenTemplateResult = {
    ok: true,
    key: spec.key,
    target,
    written: [],
    skipped: [],
    notes: [],
  };

  // 1) the template/part file.
  const filePath = join(isPart ? PARTS_DIR : TEMPLATES_DIR, `${spec.key}.ts`);
  if (existsSync(filePath) && !opts.force) {
    result.skipped.push(relativeToRepo(filePath));
  } else {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, renderTemplate(spec), 'utf8');
    result.written.push(relativeToRepo(filePath));
  }

  // 2) registry.ts / index.ts — nothing to do here any more.
  //    registry.ts is built from a scan of src/templates/ and src/parts/, so
  //    writing the file in step 1 IS the registration; which registry the
  //    template lands in is derived from its own `role` field. index.ts no
  //    longer carries a named re-export per template either — reach them via
  //    getTemplate() / getPart() / getTemplatesByRole().
  //
  //    Both files used to be spliced here via anchor regions, which made two
  //    shared core files the thing every new template had to edit — exactly
  //    what would conflict when a core update met a publisher's own templates.
  //    See docs/phase-3-versioning-and-updates-plan.md.

  // 3) role templates need a human to wire selection — the one place conditions live.
  if (isRole) {
    result.notes.push(
      `wire selection for role '${spec.role}' in packages/blocks/src/templates/resolve-template.ts ` +
        `so resolveTemplate() returns '${spec.key}' (gen never auto-wires selection conditions).`,
    );
  }
  return result;
}
