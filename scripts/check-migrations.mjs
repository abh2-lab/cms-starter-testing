#!/usr/bin/env node
// Additive-only migration guard — the safety net under the "there will be no
// v2" promise. See docs/phase-3-versioning-and-updates-plan.md.
//
//   node scripts/check-migrations.mjs              # vs HEAD (uncommitted work)
//   node scripts/check-migrations.mjs origin/main  # vs a base ref (CI)
//
// This CMS ships to outside publishers who run their own databases. A breaking
// schema change cannot be taken back: it reaches them on update and strands
// anyone who applied it. The rule ("never drop or rename a column, stop using
// it instead") was written down in CLAUDE.md and the phase-3 plan but nothing
// enforced it, so a single generated DROP COLUMN could have shipped unnoticed.
// The repo already has the scar: migration 0014 dropped pages.layout_template
// and 0015 had to add it straight back.
//
// Scans only migrations ADDED OR CHANGED in the diff, never the whole
// directory — 0005 and 0014 already contain DROP COLUMN, and a guard that is
// red on a clean checkout is a guard everyone learns to ignore.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? process.env.MIGRATION_GUARD_BASE ?? 'HEAD';

const MIGRATIONS_PREFIX = 'packages/db/migrations/';

// Statements that break an older running copy of the app, or a publisher's
// data. Each is only a problem when it lands in a NEW migration.
//
// Deliberately NOT flagged: DROP INDEX and DROP CONSTRAINT (performance or
// relaxing a rule — neither breaks old code), and ADD COLUMN ... NOT NULL
// DEFAULT (safe, and does not match SET NOT NULL).
const RULES = [
  {
    id: 'drop-column',
    re: /\bDROP\s+COLUMN\b/i,
    why: 'old code still selects it. Stop using the column instead; leave it in place.',
  },
  {
    id: 'drop-table',
    re: /\bDROP\s+TABLE\b/i,
    why: 'destroys publisher data and breaks any code still reading it.',
  },
  {
    // Any RENAME, not a shape like `RENAME COLUMN <x> TO <y>`. Identifiers are
    // usually quoted ("b"), which a \w+ pattern silently misses — and a missed
    // rename is the worst failure this guard can have. Renaming anything in a
    // shipped schema deserves a human look, and the approval note is the way
    // through.
    id: 'rename',
    re: /\bRENAME\b/i,
    why: 'a rename is a drop plus an add. Add the new name, write both, retire the old one later.',
  },
  {
    id: 'alter-type',
    re: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\bTYPE\b/i,
    why: 'old code expects the old type. Add a new column and migrate across releases.',
  },
  {
    id: 'set-not-null',
    re: /\bSET\s+NOT\s+NULL\b/i,
    why: 'any older code path still writing NULL starts failing. Backfill first, ship the write change, then constrain.',
  },
  {
    id: 'drop-type',
    re: /\bDROP\s+TYPE\b/i,
    why: 'an enum type in use cannot be recreated cleanly on a populated database.',
  },
];

// An explicit, written-down override. Deliberate breaking changes are possible
// — they just cannot be silent.
const APPROVAL = /--\s*additive-guard:\s*approved\b(.*)$/i;

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

/** Migration .sql files added or modified versus the base ref. */
function changedMigrations() {
  const tracked = git(`diff --name-only ${base}`).split('\n');
  const untracked = git('ls-files --others --exclude-standard').split('\n');
  return [...new Set([...tracked, ...untracked])]
    .map((f) => f.trim())
    .filter((f) => f.startsWith(MIGRATIONS_PREFIX) && f.endsWith('.sql'));
}

/** Strip `--` comments so prose (including the approval note) can't false-positive. */
function withoutComments(line) {
  const i = line.indexOf('--');
  return i === -1 ? line : line.slice(0, i);
}

const findings = [];

for (const file of changedMigrations()) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in this diff — nothing to police
  }
  const lines = content.split(/\r?\n/);

  // An approval applies to the line it sits on, or to the next statement line.
  const approvedLines = new Set();
  const reasons = new Map();
  lines.forEach((line, i) => {
    const m = APPROVAL.exec(line);
    if (!m) return;
    const reason = (m[1] ?? '').trim();
    for (const target of [i, i + 1]) {
      approvedLines.add(target);
      if (reason) reasons.set(target, reason);
    }
  });

  lines.forEach((rawLine, i) => {
    const line = withoutComments(rawLine);
    if (!line.trim()) return;
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue;
      if (approvedLines.has(i)) {
        console.log(
          `  approved: ${file}:${i + 1} ${rule.id}` +
            (reasons.get(i) ? ` — ${reasons.get(i)}` : ''),
        );
        continue;
      }
      findings.push({ file, line: i + 1, rule, text: rawLine.trim() });
    }
  });
}

if (findings.length === 0) {
  console.log(`✓ check:migrations: no breaking schema changes (vs ${base}).`);
  process.exit(0);
}

console.error(
  `✗ check:migrations: ${findings.length} breaking schema change(s) (vs ${base}):`,
);
console.error('');
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.rule.id}]`);
  console.error(`    ${f.text}`);
  console.error(`    ${f.rule.why}`);
  console.error('');
}
console.error(
  'This CMS ships to publishers who run their own databases — a breaking change',
);
console.error(
  'strands them. Use expand → migrate → contract across releases instead.',
);
console.error('');
console.error('If the change is genuinely intended, say so in the migration:');
console.error('    -- additive-guard: approved <why this is safe here>');
process.exit(1);
