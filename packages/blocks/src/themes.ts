import type { Block, TemplateMeta } from './types.js';
import { listBlockMetas, listTemplates, listParts } from './registry.js';
import {
  coreBlockModules,
  coreTemplateModules,
  corePartModules,
} from './generated-modules.js';
import { keysOf } from './shape.js';

// ─── Theme block manifest ───────────────────────────────────────────────────
//
// Not every block belongs to every theme. A "core"/"basic" install — the blank
// starter — exposes only the generic, reusable blocks (the WordPress-core-block
// equivalent); the full theme exposes all of them. These helpers back the
// theme-scoped list endpoints the admin calls, so a fresh starter's block
// palette isn't cluttered with another publisher's design blocks.
//
// Membership is DERIVED FROM WHERE A FILE LIVES — src/blocks vs
// src/themes/<name>/blocks — not from a hand-kept list. It used to be three
// hand-written key sets, and CORE_BLOCK_KEYS had silently drifted out of step
// with reality: it named 23 blocks while the core templates between them
// referenced 39. `single-article` alone depends on 7 blocks the list called
// non-core (post-hero, article-toc, related-posts, author-bios, …), so a
// physical split along that list would have shipped a starter whose article
// page could not render. Deriving from location makes that class of drift
// impossible.
// See docs/phase-3-versioning-and-updates-plan.md.

/**
 * Generic, theme-agnostic blocks — everything under src/blocks/. The theme
 * layer's own blocks live under src/themes/<name>/blocks/ and are excluded.
 */
export const CORE_BLOCK_KEYS: ReadonlySet<string> = keysOf(
  coreBlockModules,
  'block',
);

/**
 * Core templates. Note this is every template shipped by core, including the
 * engine ones (single, archive, search, 404, …) — `listTemplatesForTheme`
 * intersects it with the page-picker registry, which already excludes those.
 */
export const CORE_TEMPLATE_KEYS: ReadonlySet<string> = keysOf(
  coreTemplateModules,
  'template',
);

/** Site-chrome parts a core theme exposes. */
export const CORE_PART_KEYS: ReadonlySet<string> = keysOf(
  corePartModules,
  'template',
);

/**
 * A theme whose palette is the generic core subset.
 *
 * The CMS ships two themes and both are core: 'default' (the generic theme)
 * and 'basic' (the neutral starter). A publisher's CUSTOM theme — named
 * explicitly in ACTIVE_THEME, like 'ping' here — exposes the full registry,
 * because its own blocks are exactly what it adds.
 */
export function isCoreTheme(theme: string | undefined | null): boolean {
  return theme === 'basic' || theme === 'core' || theme === 'default';
}

/** Block metas visible in the admin palette for the given active theme. */
export function listBlockMetasForTheme(
  theme: string | undefined | null,
): Array<Block['meta']> {
  const metas = listBlockMetas();
  if (!isCoreTheme(theme)) return metas;
  return metas.filter((m) => CORE_BLOCK_KEYS.has(m.key));
}

/** Code page-templates visible in the "+ New Page" picker for the theme. */
export function listTemplatesForTheme(
  theme: string | undefined | null,
): TemplateMeta[] {
  const templates = listTemplates();
  if (!isCoreTheme(theme)) return templates;
  return templates.filter((t) => CORE_TEMPLATE_KEYS.has(t.key));
}

/** Parts visible for the given active theme. */
export function listPartsForTheme(
  theme: string | undefined | null,
): TemplateMeta[] {
  const parts = listParts();
  if (!isCoreTheme(theme)) return parts;
  return parts.filter((p) => CORE_PART_KEYS.has(p.key));
}
