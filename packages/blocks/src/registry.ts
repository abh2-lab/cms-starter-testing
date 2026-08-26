import type { Block, TemplateMeta, TemplateRole } from './types.js';
import {
  blockModules,
  templateModules,
  partModules,
} from './generated-modules.js';
import { isBlock, isTemplateMeta } from './shape.js';

// The block / template / part registries the API and admin endpoints read at
// request time.
//
// These used to be hand-written: every new block meant an import line AND a Map
// entry in this file, kept in sync by `pnpm gen:block` splicing into comment
// markers. That made this ONE file the place every block had to touch — which
// is precisely the file a core update and a publisher's own theme would both
// edit, so it would have conflicted on every single update.
// See docs/phase-3-versioning-and-updates-plan.md.
//
// Now: drop a file in src/blocks/ (or src/templates/, src/parts/) and it is
// registered. scripts/gen-registry.mjs writes the namespace-import manifest at
// build time; this file classifies those modules BY SHAPE, so it never depends
// on export names — which is just as well, since they do not follow the
// filename (templates/single.ts exports `singleArticle`, templates/archive.ts
// exports `archiveDefault`).

/**
 * Collect the matching exports from a group of modules, keyed by `key`.
 *
 * A duplicate key throws rather than silently last-wins. With a hand-written
 * registry a duplicate was hard to create; with a folder scan it is one
 * copy-pasted file away, and the failure it causes otherwise — the wrong block
 * rendering, with no error anywhere — is miserable to track down. Failing at
 * import time turns it into an immediate, named error. `pnpm verify:theme`
 * catches it before a deploy ever does.
 */
function collect<T>(
  modules: ReadonlyArray<Record<string, unknown>>,
  guard: (value: unknown) => value is T,
  keyOf: (value: T) => string,
  label: string,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const mod of modules) {
    for (const value of Object.values(mod)) {
      if (!guard(value)) continue;
      const key = keyOf(value);
      const existing = out.get(key);
      if (existing !== undefined) {
        throw new Error(
          `@cms/blocks: duplicate ${label} key "${key}". Two files in the ` +
            `same folder export a ${label} with this key — rename one.`,
        );
      }
      out.set(key, value);
    }
  }
  return out;
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

export const blockRegistry: ReadonlyMap<string, Block> = collect(
  blockModules,
  isBlock,
  (b) => b.meta.key,
  'block',
);

export function getBlock(key: string): Block | undefined {
  return blockRegistry.get(key);
}

export function listBlockMetas(): Array<Block['meta']> {
  return Array.from(blockRegistry.values()).map((b) => b.meta);
}

// ─── Templates ──────────────────────────────────────────────────────────────

const allTemplates: ReadonlyMap<string, TemplateMeta> = collect(
  templateModules,
  isTemplateMeta,
  (t) => t.key,
  'template',
);

/**
 * Roles that belong to the ENGINE, not to the admin's "+ New Page" picker.
 *
 * A single/archive/search/404/authors/contact template is chosen by the
 * template hierarchy at render time — offering it as a starting point for a
 * new page would produce a page that never renders as intended. Everything
 * else (an explicit `home`/`page` role, or no role at all) is pickable.
 *
 * Derived rather than hand-listed, and checked against the previous
 * hand-written membership: this rule reproduces the old 10-template picker and
 * 13-template role set exactly.
 */
const ENGINE_ONLY_ROLES: ReadonlySet<TemplateRole> = new Set<TemplateRole>([
  'single',
  'archive',
  'search',
  '404',
  'authors',
  'contact',
  'header',
  'footer',
  'sidebar',
]);

/** Templates offered in the admin's "+ New Page" picker. */
export const templateRegistry: ReadonlyMap<string, TemplateMeta> = new Map(
  Array.from(allTemplates).filter(
    ([, t]) => t.role === undefined || !ENGINE_ONLY_ROLES.has(t.role),
  ),
);

export function getTemplate(key: string): TemplateMeta | undefined {
  return templateRegistry.get(key);
}

export function listTemplates(): TemplateMeta[] {
  return Array.from(templateRegistry.values());
}

// Role-indexed lookup for the template hierarchy — the admin page templates
// PLUS the engine templates (single, archive, system pages). Deliberately
// wider than `templateRegistry`: resolveTemplate() reads this, the "+ New
// Page" picker reads that.
const roleTemplates: ReadonlyArray<TemplateMeta> = Array.from(
  allTemplates.values(),
).filter((t) => t.role !== undefined);

export function getTemplatesByRole(role: TemplateRole): TemplateMeta[] {
  return roleTemplates.filter((t) => t.role === role);
}

// ─── Parts (template-parts) ─────────────────────────────────────────────────
//
// Named, reusable block-lists with the reserved layout roles (header/footer/
// sidebar). Same TemplateMeta shape as templates, but a separate registry:
// parts are mounted by the LAYOUT / view shells (via /api/public/parts/:key),
// never selected by resolveTemplate, and must not surface in the admin's
// "+ New Page" template picker. Membership comes from the folder a file lives
// in, which is why parts are scanned as their own group.

export const partRegistry: ReadonlyMap<string, TemplateMeta> = collect(
  partModules,
  isTemplateMeta,
  (p) => p.key,
  'part',
);

export function getPart(key: string): TemplateMeta | undefined {
  return partRegistry.get(key);
}

export function listParts(): TemplateMeta[] {
  return Array.from(partRegistry.values());
}
