import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, isUndefinedTableError, schema } from '@cms/db';

type ThemeOverride = typeof schema.themeOverrides.$inferSelect;
import {
  getTemplatesByRole,
  listParts,
  PageBlockInstanceSchema,
  type PageBlockInstance,
  type TemplateMeta,
} from '@cms/blocks';
import { instancesFromTemplate } from './compose-blocks.js';
import { normalizeInstances } from './block-defaults.js';

// Theme-override resolution (theme engine v2.0). The ONE precedence rule,
// applied by every template/part composition site:
//
//   published render:  published_blocks ?? code default
//   draft preview:     draft_blocks ?? published_blocks ?? code default
//
// Binary keep/reset — a stored tree REPLACES the code tree wholesale, never
// merges with it. Stored trees are validated + normalized (defaults filled
// under stored values, unknown keys kept) so an old tree can't crash a page;
// an INVALID stored tree falls back to the code default rather than 500ing.
// The DB lookup itself is fail-open: on any query error (e.g. the
// theme_overrides migration not applied yet) public rendering proceeds on
// code defaults with a warning.

type WarnLogger = Pick<
  { warn: (obj: unknown, msg: string) => void },
  'warn'
>;

// ─── Registry access ───────────────────────────────────────────────────────

export type ThemeEntryKind = 'template' | 'part';

export interface ThemeEntry {
  kind: ThemeEntryKind;
  meta: TemplateMeta;
}

/**
 * Every overridable template/part, in display order: the engine templates
 * (single + archive roles — home/page templates are page-creation snapshots,
 * not render-time templates, so overrides don't apply to them) plus every
 * registered part.
 */
export function listThemeEntries(): ThemeEntry[] {
  const templates = [
    ...getTemplatesByRole('single'),
    ...getTemplatesByRole('archive'),
    // System pages (theme engine v2 Phase 4) — overridable like the rest.
    ...getTemplatesByRole('search'),
    ...getTemplatesByRole('404'),
    ...getTemplatesByRole('authors'),
    ...getTemplatesByRole('contact'),
  ].map((meta): ThemeEntry => ({ kind: 'template', meta }));
  // Parts live in their own registry (partRegistry), not roleTemplates.
  const parts = listParts().map((meta): ThemeEntry => ({ kind: 'part', meta }));
  return [...templates, ...parts];
}

export function findThemeEntry(key: string): ThemeEntry | null {
  return listThemeEntries().find((e) => e.meta.key === key) ?? null;
}

/** The code template's structural version (absent ⇒ 1). */
export function templateVersion(meta: TemplateMeta): number {
  return meta.version ?? 1;
}

// ─── Pure resolution core (unit-tested without a DB) ──────────────────────

const StoredTreeSchema = z.array(PageBlockInstanceSchema);

export interface OverrideRowLike {
  draftBlocks: unknown;
  publishedBlocks: unknown;
  baseVersion: number;
}

export type ResolvedSource = 'draft' | 'published' | 'code';

export interface ResolvedThemeBlocks {
  instances: PageBlockInstance[];
  source: ResolvedSource;
  // Set when a stored tree existed but failed validation and the code
  // default was used instead — callers log it.
  invalidStored?: boolean;
}

function parseStored(tree: unknown): PageBlockInstance[] | null {
  if (tree === null || tree === undefined) return null;
  const parsed = StoredTreeSchema.safeParse(tree);
  return parsed.success ? parsed.data : null;
}

/**
 * Apply the precedence rule to one override row (or its absence) and the
 * code template. Stored trees are normalized; the code path composes exactly
 * what instancesFromTemplate always produced.
 */
export function resolveOverrideInstances(
  meta: TemplateMeta,
  row: OverrideRowLike | null,
  opts: {
    draft?: boolean;
    codePrefix?: string;
    // Per-block default overrides (theme engine v2 Phase 5). Applied as a
    // default layer BENEATH the author's stored/template values but ABOVE the
    // code defaults that normalizeInstances fills — so block defaults reach a
    // CUSTOMIZED template/part (where normalization would otherwise mask them
    // with code defaults the author never chose), while a value the author
    // actually set still wins.
    blockOverrides?: Map<string, BlockOverrideValues>;
  } = {},
): ResolvedThemeBlocks {
  const overrides =
    opts.blockOverrides ?? new Map<string, BlockOverrideValues>();
  const candidates: Array<{ tree: unknown; source: ResolvedSource }> = [];
  if (opts.draft && row) {
    candidates.push({ tree: row.draftBlocks, source: 'draft' });
  }
  if (row) {
    candidates.push({ tree: row.publishedBlocks, source: 'published' });
  }

  let invalidStored = false;
  for (const c of candidates) {
    if (c.tree === null || c.tree === undefined) continue;
    const parsed = parseStored(c.tree);
    if (parsed === null) {
      invalidStored = true;
      continue;
    }
    return {
      // Block overrides go on BEFORE normalizeInstances fills code defaults, so
      // they sit between the author's stored values and the code defaults.
      instances: normalizeInstances(applyBlockOverrides(parsed, overrides)),
      source: c.source,
      ...(invalidStored ? { invalidStored: true } : {}),
    };
  }

  return {
    // codePrefix keeps deterministic id namespaces apart (parts use
    // `part-<key>`); stored overrides carry their own editor-assigned ids.
    instances: applyBlockOverrides(
      instancesFromTemplate(meta.blocks, opts.codePrefix ?? 'tpl'),
      overrides,
    ),
    source: 'code',
    ...(invalidStored ? { invalidStored: true } : {}),
  };
}

// ─── DB lookup (fail-open) ─────────────────────────────────────────────────

/**
 * Fetch the override row for a template/part key. Returns null on ANY
 * failure — including the table not existing yet (migration pending) — so a
 * public page can always render its code default.
 */
export async function fetchThemeOverride(
  log: WarnLogger,
  tenantId: string,
  templateKey: string,
): Promise<ThemeOverride | null> {
  try {
    const [row] = await db
      .select()
      .from(schema.themeOverrides)
      .where(
        and(
          eq(schema.themeOverrides.tenantId, tenantId),
          eq(schema.themeOverrides.templateKey, templateKey),
        ),
      )
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isUndefinedTableError(err, 'theme_overrides')) {
      log.warn(
        { templateKey },
        'theme-overrides: table missing (migration 0023 not applied yet) — rendering the code default',
      );
      return null;
    }
    log.warn(
      { err, templateKey },
      'theme-overrides: lookup failed — rendering the code default',
    );
    return null;
  }
}

/**
 * The composition-site entry point: override row (if any) → precedence →
 * instances. `draft: true` is the preview path (B3) — it additionally sees
 * draft_blocks.
 */
export async function resolveThemeBlocks(
  log: WarnLogger,
  tenantId: string,
  meta: TemplateMeta,
  opts: { draft?: boolean; codePrefix?: string } = {},
): Promise<ResolvedThemeBlocks> {
  const [row, blockOverrides] = await Promise.all([
    fetchThemeOverride(log, tenantId, meta.key),
    // Published per-block defaults — applied beneath the template/part's own
    // values but above code defaults (see resolveOverrideInstances). A
    // template's own draft/published state doesn't change which BLOCK defaults
    // are live, so always the published ones here.
    resolveBlockOverrides(log, tenantId),
  ]);
  const resolved = resolveOverrideInstances(meta, row, {
    ...opts,
    blockOverrides,
  });
  if (resolved.invalidStored) {
    log.warn(
      { templateKey: meta.key },
      'theme-overrides: stored tree failed validation — fell back',
    );
  }
  return resolved;
}

// ─── Per-block default overrides (theme engine v2 Phase 5) ─────────────────
//
// An admin can edit a block's default fields (copy) + options (sources) in the
// Block Gallery. The values are stored as a kind='block' override keyed
// `block:<blockKey>` (the prefix keeps it from colliding with template/part
// keys) holding a SINGLE instance. They layer UNDER each placed instance's own
// values, so they act as the block's site-wide default wherever it's used —
// per-page/template edits still win. Zero-impact when none exist (empty map →
// the instance tree is returned untouched).

export const BLOCK_OVERRIDE_KIND = 'block';
export const BLOCK_OVERRIDE_PREFIX = 'block:';

export function blockOverrideKey(blockKey: string): string {
  return `${BLOCK_OVERRIDE_PREFIX}${blockKey}`;
}

export interface BlockOverrideValues {
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
}

/**
 * Resolve a tenant's per-block default overrides: blockKey → {fields, options},
 * from published blocks (or draft when opts.draft). Empty + fail-open on any
 * error / missing table so public rendering never breaks on it.
 */
export async function resolveBlockOverrides(
  log: WarnLogger,
  tenantId: string,
  opts: { draft?: boolean } = {},
): Promise<Map<string, BlockOverrideValues>> {
  const out = new Map<string, BlockOverrideValues>();
  let rows: ThemeOverride[];
  try {
    rows = await db
      .select()
      .from(schema.themeOverrides)
      .where(
        and(
          eq(schema.themeOverrides.tenantId, tenantId),
          eq(schema.themeOverrides.kind, BLOCK_OVERRIDE_KIND),
        ),
      );
  } catch (err) {
    if (!isUndefinedTableError(err, 'theme_overrides')) {
      log.warn(
        { err },
        'block-overrides: lookup failed — no per-block defaults applied',
      );
    }
    return out;
  }
  for (const row of rows) {
    if (!row.templateKey.startsWith(BLOCK_OVERRIDE_PREFIX)) continue;
    const tree = opts.draft
      ? (row.draftBlocks ?? row.publishedBlocks)
      : row.publishedBlocks;
    const inst = parseStored(tree)?.[0];
    if (!inst) continue;
    out.set(row.templateKey.slice(BLOCK_OVERRIDE_PREFIX.length), {
      fields: inst.fields ?? {},
      options: inst.options ?? {},
    });
  }
  return out;
}

/**
 * Merge per-block overrides UNDER each instance's own fields/options (instance
 * wins), recursively. Returns the instances unchanged when there are none.
 */
export function applyBlockOverrides(
  instances: PageBlockInstance[],
  overrides: Map<string, BlockOverrideValues>,
): PageBlockInstance[] {
  if (overrides.size === 0) return instances;
  return instances.map((inst) => {
    const ov = overrides.get(inst.block_key);
    const out: PageBlockInstance = ov
      ? {
          ...inst,
          fields: { ...ov.fields, ...inst.fields },
          options: { ...ov.options, ...inst.options },
        }
      : { ...inst };
    if (inst.children?.length) {
      out.children = applyBlockOverrides(inst.children, overrides);
    }
    return out;
  });
}

/**
 * Composition-site convenience: resolve the tenant's PUBLISHED block overrides
 * and apply them to a ready instance tree before composeBlocks.
 */
export async function withBlockOverrides(
  log: WarnLogger,
  tenantId: string,
  instances: PageBlockInstance[],
): Promise<PageBlockInstance[]> {
  const overrides = await resolveBlockOverrides(log, tenantId);
  return applyBlockOverrides(instances, overrides);
}
