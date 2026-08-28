import { dirname, join, relative, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve the monorepo root by walking up from this module until we find the
// pnpm-workspace.yaml. Robust to the CWD the CLI is invoked from (repo root, the
// theme-kit package dir under `pnpm --filter`, or anywhere else).
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `theme-kit: could not locate the repo root (no pnpm-workspace.yaml found walking up from ${fileURLToPath(import.meta.url)})`,
  );
}

export const REPO_ROOT = findRepoRoot();

// The theme the kit authors against. Single-theme today; if multi-theme lands,
// thread an active-theme arg through here.
// The THEME layer gen writes into, and the CORE layer it sits on top of.
//
// themes/default is the generic core layer: the 39 core renderers, the pages,
// and the data layer that ship to every publisher. The THEME layer is whichever
// theme this install runs — ACTIVE_THEME — and it is NOT fixed: a publisher's
// custom theme is excluded from the starter export, so hardcoding one name
// made `verify:theme:structure` look for a file the export does not contain and
// failed the web image build for every publisher.
//
// Falls back to 'basic', the theme the blank starter ships with, and then to
// 'default' if even that is absent. gen:block writes a block's Vue half into
// this layer; verification considers BOTH, since a renderer may live in either.
// See docs/phase-3-versioning-and-updates-plan.md.
const WEB_THEMES_DIR = resolve(REPO_ROOT, 'apps/web/themes');

/**
 * ACTIVE_THEME from the monorepo root .env, when it is not already in the
 * environment.
 *
 * The kit runs as a plain CLI under pnpm, which does not load that file — api
 * and worker pass `--env-file=../../.env` explicitly and nuxt.config reads it
 * by hand. Without this, ACTIVE_THEME never arrives and every verification run
 * resolves to the fallback theme, reporting every custom block as unrendered.
 */
function activeThemeFromRootEnv(): string {
  const fromProcess = (process.env['ACTIVE_THEME'] ?? '').trim();
  if (fromProcess) return fromProcess;
  const envFile = join(REPO_ROOT, '.env');
  if (!existsSync(envFile)) return '';
  for (const rawLine of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== 'ACTIVE_THEME') continue;
    return line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function resolveActiveTheme(): string {
  const requested = activeThemeFromRootEnv();
  for (const name of [requested, 'basic', 'default']) {
    if (name && existsSync(join(WEB_THEMES_DIR, name))) return name;
  }
  return 'default';
}

/**
 * EVERY theme layer present in the tree, `default` excluded.
 *
 * Verification must not depend on which theme is "active". The check it runs —
 * does each server block have a Vue renderer — is answered by whichever layer
 * owns that block, and a layer owns its blocks whether or not it happens to be
 * selected right now. Keying off ACTIVE_THEME made the answer depend on an env
 * var, which is absent in CI and absent again inside the Docker build (a
 * workflow's `env:` does not cross into `docker build`), so the same failure
 * appeared in three separate places.
 *
 * Scanning every layer is also correct for the starter export, which contains
 * no custom theme at all: there are simply no theme blocks to render.
 */
export const ALL_THEME_NAMES: readonly string[] = existsSync(WEB_THEMES_DIR)
  ? readdirSync(WEB_THEMES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'default')
      .map((e) => e.name)
      .sort()
  : [];

/** Each theme layer's Vue block registry. Missing files are normal. */
export const ALL_VUE_REGISTRY_FILES: readonly string[] = ALL_THEME_NAMES.map(
  (name) => resolve(WEB_THEMES_DIR, name, 'app/composables/useBlockRegistry.ts'),
);

/** Each theme layer's block-component directory. */
export const ALL_THEME_BLOCKS_DIRS: readonly string[] = ALL_THEME_NAMES.map(
  (name) => resolve(WEB_THEMES_DIR, name, 'app/components/blocks'),
);

export const ACTIVE_THEME_NAME = resolveActiveTheme();
export const THEME_DIR = resolve(WEB_THEMES_DIR, ACTIVE_THEME_NAME);
export const CORE_THEME_DIR = resolve(REPO_ROOT, 'apps/web/themes/default');

// @cms/blocks — the server half.
//
// gen writes into the THEME layer, never into core. src/blocks, src/templates
// and src/parts now hold the 39 generic blocks and the engine templates that
// ship to every publisher; a theme's own blocks live under
// src/themes/<name>/. An authoring session must not add files to core — that
// is the whole point of the split, and check-theme-scope.mjs enforces it.
// See docs/phase-3-versioning-and-updates-plan.md.
export const BLOCKS_SRC = resolve(REPO_ROOT, 'packages/blocks/src');
// The active theme's server blocks. May legitimately not exist — themes/basic
// has no server-side blocks of its own, it only re-skins core's.
export const THEME_SERVER_DIR = resolve(
  BLOCKS_SRC,
  `themes/${ACTIVE_THEME_NAME}`,
);
export const BLOCKS_DIR = resolve(THEME_SERVER_DIR, 'blocks');
export const TEMPLATES_DIR = resolve(THEME_SERVER_DIR, 'templates');
export const PARTS_DIR = resolve(THEME_SERVER_DIR, 'parts');
// NOTE: registry.ts and index.ts used to be listed here so gen could splice
// entries into them. They are no longer written by gen — registry.ts is built
// from a scan of the directories above, so creating a file in one of them IS
// the registration. Deliberately not re-added: a path constant here is an
// invitation to start hand-editing a shared core file again.

/**
 * The `@cms/blocks` types import specifier to emit inside a generated file,
 * computed from where that file actually lands.
 *
 * Computed, not hardcoded: generated files used to sit at src/blocks/ and so
 * emitted `'../types.js'`. Moving gen's output into src/themes/<name>/blocks/
 * in v1.3.0 made that wrong by two levels, and nothing caught it — the emitted
 * file simply failed to compile. Deriving it means the next move (the theme
 * folder leaving for its own repo in v1.5.0) cannot silently break it either.
 */
function typesSpecifierFor(dir: string): string {
  const rel = relative(dir, join(BLOCKS_SRC, 'types.js')).split('\\').join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

export const BLOCK_TYPES_IMPORT = typesSpecifierFor(BLOCKS_DIR);
export const TEMPLATE_TYPES_IMPORT = typesSpecifierFor(TEMPLATES_DIR);
export const PART_TYPES_IMPORT = typesSpecifierFor(PARTS_DIR);

// The theme render half.
export const THEME_BLOCKS_DIR = resolve(THEME_DIR, 'app/components/blocks');
export const VUE_REGISTRY_FILE = resolve(
  THEME_DIR,
  'app/composables/useBlockRegistry.ts',
);
export const CORE_THEME_BLOCKS_DIR = resolve(
  CORE_THEME_DIR,
  'app/components/blocks',
);
export const CORE_VUE_REGISTRY_FILE = resolve(
  CORE_THEME_DIR,
  'app/composables/useBlockRegistry.ts',
);

// Authored sample content (seed fixtures).
export const FIXTURES_DIR = resolve(REPO_ROOT, 'apps/api/fixtures');

// Render an absolute path as a clean repo-relative POSIX path for reporting.
export function relativeToRepo(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).replace(/\\/g, '/');
}
