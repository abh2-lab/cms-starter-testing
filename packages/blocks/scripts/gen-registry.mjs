#!/usr/bin/env node
// Generate src/generated-modules.ts — the namespace-import manifest that
// registry.ts classifies into the block/template/part registries.
//
// Why this exists: registry.ts used to hand-list every block twice (an import
// line and a Map entry). That made ONE shared file the place every new block
// had to touch — exactly the file a core update and a publisher's theme would
// both edit, and therefore the file that would conflict on every update.
// See docs/phase-3-versioning-and-updates-plan.md.
//
// Why codegen instead of a runtime directory scan:
//   1. dist/ accumulates STALE output. tsc never deletes the .js of a source
//      file you removed — this package had 11 orphaned blocks and 1 orphaned
//      template sitting in dist/. A runtime scan would resurrect all of them.
//      Generating from src/ can only ever see files that really exist.
//   2. @cms/blocks is consumed by the Nuxt web app as well as the Node API.
//      Static imports work in both; a runtime fs scan would break the bundler.
//   3. No async init. The registry stays a plain module-level Map, so every
//      existing caller keeps working unchanged.
//
// Why NAMESPACE imports (`import * as m0`) rather than named ones: export
// names do not follow the filename. templates/single.ts exports
// `singleArticle`, templates/archive.ts exports `archiveDefault`,
// templates/not-found.ts exports `notFoundTemplate`. Importing the whole
// module and letting registry.ts pick out the values by SHAPE means the
// codegen never has to guess a name, and a file may export more than one.
//
// Run by `pnpm --filter @cms/blocks build` before tsc. The output is
// gitignored: it is derived, and committing it would reintroduce the very
// shared file this removes.

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src');
const DIST = resolve(HERE, '..', 'dist');
const OUT = join(SRC, 'generated-modules.ts');

/**
 * The theme layer. Everything under here is the PUBLISHER's — their blocks,
 * templates and parts — and moves out to its own repo in v1.5.0. Core code
 * must never edit it, and core templates must never depend on it.
 * See docs/phase-3-versioning-and-updates-plan.md.
 */
const THEME_ROOT = 'themes/ping';

/**
 * Folders scanned, and the exported array each populates.
 *
 * Core and theme are scanned SEPARATELY and kept as separate exports, so
 * "is this block core?" is answered by where the file lives instead of by a
 * hand-maintained list. That list (CORE_BLOCK_KEYS in themes.ts) had drifted:
 * it named 23 blocks while the core templates actually referenced 39.
 */
const GROUPS = [
  { dir: 'blocks', exportName: 'coreBlockModules', scope: 'core' },
  { dir: 'templates', exportName: 'coreTemplateModules', scope: 'core' },
  { dir: 'parts', exportName: 'corePartModules', scope: 'core' },
  { dir: `${THEME_ROOT}/blocks`, exportName: 'themeBlockModules', scope: 'theme' },
  { dir: `${THEME_ROOT}/templates`, exportName: 'themeTemplateModules', scope: 'theme' },
  { dir: `${THEME_ROOT}/parts`, exportName: 'themePartModules', scope: 'theme' },
];

function sourceFiles(dir) {
  const full = join(SRC, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    // Stable order so the generated file does not churn between machines
    // (readdir order is filesystem-dependent).
    .sort();
}

const imports = [];
const groupArrays = [];
let n = 0;

for (const { dir, exportName } of GROUPS) {
  const names = sourceFiles(dir);
  const aliases = [];
  for (const name of names) {
    const alias = `m${n++}`;
    // NodeNext ESM: the .js extension is required in the emitted import.
    imports.push(`import * as ${alias} from './${dir}/${name}.js';`);
    aliases.push(alias);
  }
  groupArrays.push(
    `/** ${names.length} file(s) from src/${dir}/ */\n` +
      `export const ${exportName}: ReadonlyArray<Record<string, unknown>> = [\n` +
      aliases.map((a) => `  ${a},`).join('\n') +
      (aliases.length ? '\n' : '') +
      `];`,
  );
}

// Combined views. registry.ts builds the runtime registries from these and
// does not care where a module came from; themes.ts uses the core-only arrays
// above to answer "is this block part of core?".
groupArrays.push(
  `export const blockModules: ReadonlyArray<Record<string, unknown>> = [\n` +
    `  ...coreBlockModules,\n  ...themeBlockModules,\n];\n\n` +
    `export const templateModules: ReadonlyArray<Record<string, unknown>> = [\n` +
    `  ...coreTemplateModules,\n  ...themeTemplateModules,\n];\n\n` +
    `export const partModules: ReadonlyArray<Record<string, unknown>> = [\n` +
    `  ...corePartModules,\n  ...themePartModules,\n];`,
);

const banner = `// GENERATED FILE — DO NOT EDIT, DO NOT COMMIT.
// Written by scripts/gen-registry.mjs, which runs as part of \`pnpm build\`.
// Add a block by dropping a file in src/blocks/ — nothing here is hand-managed.
`;

const body = `${banner}
${imports.join('\n')}

${groupArrays.join('\n\n')}
`;

// Only write when the content actually changed, so an unchanged rebuild does
// not bump the mtime and defeat tsc's incremental build.
const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
if (previous === body) {
  console.log(`gen-registry: up to date (${n} modules)`);
} else {
  writeFileSync(OUT, body, 'utf8');
  console.log(`gen-registry: wrote src/generated-modules.ts (${n} modules)`);
}

// ─── Prune orphaned dist output ─────────────────────────────────────────────
//
// tsc never deletes the emitted .js of a source file you removed. This package
// had accumulated 11 orphaned blocks and 1 orphaned template that way. They
// were invisible to the old hand-written registry, but a scan-based one must
// not be able to see them either — and stale output is confusing regardless.
//
// Surgically, NOT `rimraf dist`. Deleting the whole directory leaves a window
// where dist does not exist, and anything watching (a running `tsx watch` API)
// crashes with ERR_MODULE_NOT_FOUND if it imports during that gap. Removing
// only the specific orphans means a valid dist is never absent.
let pruned = 0;
for (const { dir } of GROUPS) {
  const distDir = join(DIST, dir);
  if (!existsSync(distDir)) continue;
  const keep = new Set(sourceFiles(dir));
  for (const file of readdirSync(distDir)) {
    // Every artifact tsc emits per source: .js, .d.ts, and their source maps.
    const base = file.replace(/\.(js|d\.ts)(\.map)?$/, '');
    if (base === file) continue; // not an emitted artifact — leave it alone
    if (keep.has(base)) continue;
    rmSync(join(distDir, file), { force: true });
    pruned++;
  }
}
if (pruned > 0) {
  console.log(`gen-registry: pruned ${pruned} orphaned file(s) from dist/`);
}
