// verify:theme:content — the content half of the theme gate (Phase 2). It runs
// where apps/api lives (the fixture schemas are here), so @cms/theme-kit's
// structure gate stays free of any apps/api import.
//
// Two checks:
//   1. fixture-schema  — every set under apps/api/fixtures/<name>/ validates
//      against the fixture-loader zod schemas (reuses readAndValidateFixtures,
//      which is DB-free).
//   2. block-fixture-binding — every content_type_slug / category_slug /
//      content_slug a template/part DEFAULT-binds exists in the fixtures. Catches
//      the "passes structure-smoke but renders blank" trap (the bound CPT/term
//      isn't seeded). Checked against the UNION of the validated sets, so a
//      built-in template backed by one set isn't false-flagged by another.
//
//   pnpm --filter @cms/api verify:fixtures            # all sets
//   pnpm --filter @cms/api verify:fixtures -- --set example --json

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  blockRegistry,
  getTemplatesByRole,
  partRegistry,
  templateRegistry,
  TEMPLATE_ROLES,
} from '@cms/blocks';
import type { TemplateBlock, TemplateMeta } from '@cms/blocks';
import { readAndValidateFixtures } from '../src/services/fixture-loader/validate.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

interface Finding {
  check: 'fixtures' | 'fixture-schema' | 'block-fixture-binding';
  set?: string;
  message: string;
  fix: string;
}

interface SlugSets {
  contentTypeSlugs: Set<string>;
  termSlugs: Set<string>;
  postSlugs: Set<string>;
}

function fixtureSets(filter: string | undefined): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((name) => statSync(join(FIXTURES_DIR, name)).isDirectory())
    .filter((name) => filter === undefined || name === filter);
}

function allTemplatesAndParts(): TemplateMeta[] {
  const byKey = new Map<string, TemplateMeta>();
  for (const t of templateRegistry.values()) byKey.set(t.key, t);
  for (const role of TEMPLATE_ROLES) for (const t of getTemplatesByRole(role)) byKey.set(t.key, t);
  for (const p of partRegistry.values()) byKey.set(p.key, p);
  return [...byKey.values()];
}

function walkBindings(
  tpl: TemplateMeta,
  blocks: TemplateBlock[],
  slugs: SlugSets,
  findings: Finding[],
): void {
  for (const inst of blocks) {
    const block = blockRegistry.get(inst.block_key);
    if (block) {
      for (const opt of block.meta.options) {
        const val = inst.default_options[opt.key];
        if (typeof val !== 'string' || val.length === 0) continue;
        if (opt.type === 'content_type_slug' && !slugs.contentTypeSlugs.has(val)) {
          findings.push({
            check: 'block-fixture-binding',
            message: `'${tpl.key}' → block '${inst.block_key}' binds content_type '${val}', not provided by any fixture set`,
            fix: `add a content type with slug '${val}' to a fixture set, or fix the default_options binding`,
          });
        } else if (opt.type === 'category_slug' && !slugs.termSlugs.has(val)) {
          findings.push({
            check: 'block-fixture-binding',
            message: `'${tpl.key}' → block '${inst.block_key}' binds term '${val}', not provided by any fixture set`,
            fix: `add a taxonomy term with slug '${val}', or fix the default_options binding`,
          });
        } else if (opt.type === 'content_slug' && !slugs.postSlugs.has(val)) {
          findings.push({
            check: 'block-fixture-binding',
            message: `'${tpl.key}' → block '${inst.block_key}' binds content '${val}', not provided by any fixture set`,
            fix: `add a post with slug '${val}', or fix the default_options binding`,
          });
        }
      }
    }
    if (inst.children) walkBindings(tpl, inst.children, slugs, findings);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    allowPositionals: false,
    options: { set: { type: 'string' }, json: { type: 'boolean' } },
  });
  const setFilter = typeof values.set === 'string' ? values.set : undefined;
  const sets = fixtureSets(setFilter);
  const findings: Finding[] = [];
  const slugs: SlugSets = {
    contentTypeSlugs: new Set(),
    termSlugs: new Set(),
    postSlugs: new Set(),
  };

  if (sets.length === 0) {
    findings.push({
      check: 'fixtures',
      message: setFilter
        ? `no fixture set '${setFilter}' under apps/api/fixtures/`
        : 'no fixture sets under apps/api/fixtures/',
      fix: 'author a fixture set (see apps/api/fixtures/example for the shape)',
    });
  }

  for (const set of sets) {
    try {
      const parsed = await readAndValidateFixtures(join(FIXTURES_DIR, set));
      for (const ct of parsed.contentTypes) slugs.contentTypeSlugs.add(ct.slug);
      for (const tax of parsed.taxonomies) for (const term of tax.terms) slugs.termSlugs.add(term.slug);
      for (const post of parsed.posts) slugs.postSlugs.add(post.slug);
    } catch (err) {
      findings.push({
        check: 'fixture-schema',
        set,
        message: (err as Error).message,
        fix: `fix the invalid fixture JSON in apps/api/fixtures/${set}`,
      });
    }
  }

  for (const tpl of allTemplatesAndParts()) {
    walkBindings(tpl, tpl.blocks, slugs, findings);
  }

  const ok = findings.length === 0;
  if (values.json === true) {
    process.stdout.write(`${JSON.stringify({ ok, sets, findings }, null, 2)}\n`);
  } else if (ok) {
    process.stdout.write(
      `✓ verify:theme:content — GREEN (${sets.length} fixture set(s): ${sets.join(', ') || 'none'})\n`,
    );
  } else {
    process.stdout.write(`✗ verify:theme:content — ${findings.length} finding(s):\n`);
    for (const f of findings) {
      const tag = f.set ? `${f.check}:${f.set}` : f.check;
      process.stdout.write(`    • [${tag}] ${f.message}\n      ↳ ${f.fix}\n`);
    }
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(`verify:fixtures — ${(err as Error).message}\n`);
  process.exit(1);
});
