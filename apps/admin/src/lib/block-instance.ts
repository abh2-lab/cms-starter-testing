import type { BlockMeta, PageBlockInstance } from '@/api/pages';

// Block-instance construction for the unified blocks editor's tree
// (components/editor/useBlockTree.ts) — kept here so id format and default
// seeding live in one place.

export function genInstanceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultsFrom(
  fields: BlockMeta['fields'],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

export function buildInstance(
  meta: BlockMeta | undefined,
): PageBlockInstance | null {
  if (!meta) return null;
  return {
    id: genInstanceId(),
    block_key: meta.key,
    fields: defaultsFrom(meta.fields),
    options: defaultsFrom(meta.options),
  };
}
