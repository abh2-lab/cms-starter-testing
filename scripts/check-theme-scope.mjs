#!/usr/bin/env node
// Diff-scope guard — the second half of the Phase 2 containment fence (the first
// is the eslint import-boundary rule). It fails if an AUTHORING session's changes
// touch anything OUTSIDE the theme-authoring surface, so a publisher's AI agent
// can't quietly edit API routes, the composer, or the DB while building a theme.
//
//   node scripts/check-theme-scope.mjs              # vs HEAD (uncommitted changes)
//   node scripts/check-theme-scope.mjs origin/main  # vs a base ref (CI / pre-push)
//
// NOTE: this polices THEME-AUTHORING sessions, not kit/infra development. Editing
// the kit itself (packages/theme-kit, the Dockerfiles, eslint config) is expected
// to fall outside the surface — run this only against authoring changes.

import { execSync } from 'node:child_process';

const base = process.argv[2] ?? process.env.THEME_SCOPE_BASE ?? 'HEAD';

// The theme-authoring surface: what gen writes and an author hand-edits.
//
// Tightened in v1.3.0. This used to allow packages/blocks/src/{blocks,
// templates,parts} — but those are now CORE: the 39 generic blocks and the
// engine templates that ship to every publisher. A theme's own server blocks
// live under packages/blocks/src/themes/<name>/, which is the folder that
// moves out to the publisher's own repo in v1.5.0.
//
// registry.ts and index.ts are no longer listed either. They were allowed
// because gen had to splice entries into them; the registry is now built from
// a folder scan, so an authoring session has no reason to touch either — and
// letting it would put back exactly the shared-file conflict the split removed.
// See docs/phase-3-versioning-and-updates-plan.md.
const ALLOWED_PREFIXES = [
  'packages/blocks/src/themes/', // a theme's server blocks/templates/parts
  'apps/web/themes/', // a theme's components, composables, assets, CSS
  'apps/api/fixtures/', // authored sample content
];

// ...but NOT the two themes the CMS itself ships. 'default' is the generic core
// layer and 'basic' the neutral starter; both are CMS parts that receive
// updates, so an authoring session editing them would create exactly the
// merge conflict this split exists to prevent. Authoring belongs in a CUSTOM
// theme — a directory the publisher creates, like themes/ping here.
const CMS_THEMES = ['default', 'basic'];
const DENIED_PREFIXES = CMS_THEMES.flatMap((name) => [
  `packages/blocks/src/themes/${name}/`,
  `apps/web/themes/${name}/`,
]);
const ALLOWED_FILES = new Set();

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

function changedFiles() {
  const tracked = git(`diff --name-only ${base}`).split('\n');
  const untracked = git('ls-files --others --exclude-standard').split('\n');
  return [...new Set([...tracked, ...untracked])].filter((f) => f.length > 0);
}

function isAllowed(file) {
  if (DENIED_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  if (ALLOWED_FILES.has(file)) return true;
  return ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

const files = changedFiles();
const outOfScope = files.filter((f) => !isAllowed(f));

if (outOfScope.length === 0) {
  console.log(
    `✓ theme-scope: ${files.length} changed file(s), all within the theme surface (vs ${base}).`,
  );
  process.exit(0);
}

console.error(
  `✗ theme-scope: ${outOfScope.length} change(s) outside the theme-authoring surface (vs ${base}):`,
);
for (const f of outOfScope) console.error(`    ${f}`);
console.error('');
console.error(
  'Theme authoring may edit only: packages/blocks/src/themes/**, apps/web/themes/**,',
);
console.error(
  'and apps/api/fixtures/**. packages/blocks/src/{blocks,templates,parts} is CORE — it ships',
);
console.error(
  'to every publisher. Move other changes to a separate task.',
);
process.exit(1);
