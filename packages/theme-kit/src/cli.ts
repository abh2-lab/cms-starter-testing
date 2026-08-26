import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { genBlock, normalizeBlockSpec } from './gen/gen-block.js';
import type { GenBlockResult } from './gen/gen-block.js';
import { genTemplate, normalizeTemplateSpec } from './gen/gen-template.js';
import type { GenTemplateResult } from './gen/gen-template.js';
import { verifyStructure } from './verify/verify-structure.js';
import type { VerifyReport } from './verify/verify-structure.js';

// `@cms/theme-kit` CLI — the deterministic generators + structure gate the AI
// theme-authoring loop drives. No MCP: any assistant can shell out to these.
//
//   pnpm gen:block --spec block.json
//   pnpm gen:block --key author-card --kind standalone --label "Author Card" --category lead
//   pnpm verify:theme:structure          (also: pnpm verify:theme runs content checks too)

function fail(message: string): never {
  process.stderr.write(`theme-kit: ${message}\n`);
  process.exit(1);
}

function runGenBlock(argv: string[]): void {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        spec: { type: 'string' },
        json: { type: 'string' },
        key: { type: 'string' },
        kind: { type: 'string' },
        label: { type: 'string' },
        category: { type: 'string' },
        description: { type: 'string' },
        icon: { type: 'string' },
        fields: { type: 'string' },
        options: { type: 'string' },
        lazy: { type: 'boolean' },
        force: { type: 'boolean' },
      },
    }));
  } catch (err) {
    fail(`gen:block — ${(err as Error).message}`);
  }

  let raw: Record<string, unknown> = {};
  try {
    if (typeof values.spec === 'string') {
      raw = JSON.parse(readFileSync(values.spec, 'utf8')) as Record<string, unknown>;
    } else if (typeof values.json === 'string') {
      raw = JSON.parse(values.json) as Record<string, unknown>;
    }
    if (values.key !== undefined) raw['key'] = values.key;
    if (values.kind !== undefined) raw['kind'] = values.kind;
    if (values.label !== undefined) raw['label'] = values.label;
    if (values.category !== undefined) raw['category'] = values.category;
    if (values.description !== undefined) raw['description'] = values.description;
    if (values.icon !== undefined) raw['icon'] = values.icon;
    if (values.lazy !== undefined) raw['lazy'] = values.lazy;
    if (values.fields !== undefined) raw['fields'] = JSON.parse(values.fields);
    if (values.options !== undefined) raw['options'] = JSON.parse(values.options);
  } catch (err) {
    fail(`gen:block — could not read spec: ${(err as Error).message}`);
  }

  let result: GenBlockResult;
  try {
    const spec = normalizeBlockSpec(raw);
    result = genBlock(spec, { force: values.force === true });
  } catch (err) {
    fail(`gen:block — ${(err as Error).message}`);
  }

  const out: string[] = [`✓ gen:block '${result.key}' — both halves written; server registry is automatic.`];
  if (result.written.length) out.push(`  written:\n${result.written.map((p) => `    ${p}`).join('\n')}`);
  if (result.skipped.length) {
    out.push(
      `  skipped (already exist — pass --force to overwrite):\n${result.skipped
        .map((p) => `    ${p}`)
        .join('\n')}`,
    );
  }
  out.push('  next:');
  out.push('    1. fill in load() in the server file + the markup/styles in the .vue');
  out.push('    2. run `pnpm verify:theme` (it rebuilds @cms/blocks and checks coherence)');
  out.push('    3. preview in hybrid (`pnpm dev`) before human QA — verify proves structure, not pixels');
  process.stdout.write(out.join('\n') + '\n');
}

function runGenTemplate(argv: string[]): void {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        spec: { type: 'string' },
        json: { type: 'string' },
        key: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        previewImage: { type: 'string' },
        role: { type: 'string' },
        version: { type: 'string' },
        blocks: { type: 'string' },
        force: { type: 'boolean' },
      },
    }));
  } catch (err) {
    fail(`gen:template — ${(err as Error).message}`);
  }

  let raw: Record<string, unknown> = {};
  try {
    if (typeof values.spec === 'string') {
      raw = JSON.parse(readFileSync(values.spec, 'utf8')) as Record<string, unknown>;
    } else if (typeof values.json === 'string') {
      raw = JSON.parse(values.json) as Record<string, unknown>;
    }
    if (values.key !== undefined) raw['key'] = values.key;
    if (values.name !== undefined) raw['name'] = values.name;
    if (values.description !== undefined) raw['description'] = values.description;
    if (values.previewImage !== undefined) raw['previewImage'] = values.previewImage;
    if (values.role !== undefined) raw['role'] = values.role;
    if (values.version !== undefined) raw['version'] = Number(values.version);
    if (values.blocks !== undefined) raw['blocks'] = JSON.parse(values.blocks);
  } catch (err) {
    fail(`gen:template — could not read spec: ${(err as Error).message}`);
  }

  let result: GenTemplateResult;
  try {
    const spec = normalizeTemplateSpec(raw);
    result = genTemplate(spec, { force: values.force === true });
  } catch (err) {
    fail(`gen:template — ${(err as Error).message}`);
  }

  const out: string[] = [`✓ gen:template '${result.key}' (${result.target}) wired.`];
  if (result.written.length) out.push(`  written:\n${result.written.map((p) => `    ${p}`).join('\n')}`);
  if (result.skipped.length) {
    out.push(`  skipped (exists — pass --force):\n${result.skipped.map((p) => `    ${p}`).join('\n')}`);
  }
  for (const note of result.notes) out.push(`  ⚠ ${note}`);
  out.push('  next: run `pnpm verify:theme`, then preview in hybrid before human QA.');
  process.stdout.write(out.join('\n') + '\n');
}

function printVerifyReport(report: VerifyReport): void {
  const lines: string[] = [];
  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✓' : '✗';
    const count = check.findings.length ? ` (${check.findings.length})` : '';
    lines.push(`${icon} ${check.check} — ${check.status}${count}`);
    for (const finding of check.findings) {
      const loc = finding.key ? ` [${finding.key}]` : '';
      lines.push(`    •${loc} ${finding.message}`);
      lines.push(`      ↳ ${finding.fix}`);
    }
  }
  lines.push('');
  lines.push(report.ok ? 'verify:theme:structure — GREEN' : 'verify:theme:structure — FAILED');
  process.stdout.write(lines.join('\n') + '\n');
}

async function runVerify(argv: string[]): Promise<void> {
  let json = false;
  try {
    const { values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: { json: { type: 'boolean' } },
    });
    json = values.json === true;
  } catch (err) {
    fail(`verify — ${(err as Error).message}`);
  }

  const report = await verifyStructure();
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printVerifyReport(report);
  }
  process.exit(report.ok ? 0 : 1);
}

const [, , command, ...rawArgs] = process.argv;
// Strip any standalone `--` the pnpm script chain injects when forwarding args
// (root `pnpm … gen:block --` → `pnpm --filter … gen:block -- <args>` leaves a
// literal `--` in argv that node:util parseArgs would treat as a positional).
const rest = rawArgs.filter((arg) => arg !== '--');
switch (command) {
  case 'gen:block':
    runGenBlock(rest);
    break;
  case 'gen:template':
    runGenTemplate(rest);
    break;
  case 'verify':
    runVerify(rest).catch((err: unknown) => fail(`verify — ${(err as Error).message}`));
    break;
  default:
    fail(`unknown command '${command ?? ''}' — expected one of: gen:block | gen:template | verify`);
}
