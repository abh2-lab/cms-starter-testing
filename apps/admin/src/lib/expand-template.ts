import type { BlockMeta, PageBlockInstance } from '@/api/pages';

// Shared "template → block instances" expansion.
//
// Used by the page editor adapter (usePageEditorAdapter) that backs the unified
// blocks editor — for both its load-template action and the template-first
// dynamic-page create flow (PageNew). Each block is seeded with
// its schema defaults; keys that aren't in the live block manifest are reported
// in `skipped` so the caller can warn instead of silently dropping them.

export function genInstanceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultsFor(
  fields: BlockMeta['fields'],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

export interface ExpandResult {
  blocks: PageBlockInstance[];
  /** block_keys present in the template but missing from the manifest. */
  skipped: string[];
}

export function expandTemplate(
  blockKeys: string[],
  blockMetas: BlockMeta[],
): ExpandResult {
  const metaByKey = new Map(blockMetas.map((m) => [m.key, m]));
  const blocks: PageBlockInstance[] = [];
  const skipped: string[] = [];
  for (const k of blockKeys) {
    const meta = metaByKey.get(k);
    if (!meta) {
      skipped.push(k);
      continue;
    }
    blocks.push({
      id: genInstanceId(),
      block_key: k,
      fields: defaultsFor(meta.fields),
      options: defaultsFor(meta.options),
    });
  }
  return { blocks, skipped };
}
