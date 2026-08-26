import { getBlock, type BlockField, type PageBlockInstance } from '@cms/blocks';

// Block settings tolerance (theme engine v2.0). Stored override trees may
// predate a block's current schema (missing settings) or outlive a removed
// one (unknown settings) — old saved trees must NEVER crash a page. The
// strategy: fill schema defaults UNDER stored values, pass unknown keys
// through untouched (block components read defensively and ignore them),
// and leave unknown block_keys in place for the composer's `unknown_block`
// degradation leaf.

/**
 * Build a defaults record from a field schema: each field's declared
 * `default`, else a type-appropriate empty. Shared by the block-preview
 * route (apps/api/src/routes/public/blocks.ts) and override normalization —
 * and it mirrors the admin's `defaultsFrom()` in lib/block-instance.ts, so the
 * values a loader sees match what the admin sees on first Add.
 */
export function defaultsFor(fields: BlockField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) {
      out[f.key] = f.default;
      continue;
    }
    // Sensible empties so block loaders don't NPE on missing keys.
    switch (f.type) {
      case 'short_text':
      case 'long_text':
      case 'url':
      case 'select':
      case 'content_slug':
      case 'content_type_slug':
      case 'category_slug':
        out[f.key] = '';
        break;
      case 'kv_list':
        out[f.key] = [];
        break;
      case 'boolean':
        out[f.key] = false;
        break;
      // number / unrecognised → omit the key; loaders supply their own
      // numeric fallbacks (e.g. count ?? 6) and a missing key is closer to
      // "user hasn't set this" than a hard 0.
      default:
        break;
    }
  }
  return out;
}

/**
 * Walk a stored override tree and merge each known block's schema defaults
 * UNDER its stored fields/options (stored values win; unknown keys —
 * including the structural `region` — pass through). Unknown block_keys stay
 * untouched so the composer degrades them per-node instead of the whole tree
 * falling back. Applied ONLY on the override path — code templates and
 * stored pages compose exactly as before.
 */
export function normalizeInstances(
  instances: PageBlockInstance[],
): PageBlockInstance[] {
  return instances.map((inst) => {
    const meta = getBlock(inst.block_key)?.meta;
    const out: PageBlockInstance = meta
      ? {
          ...inst,
          fields: { ...defaultsFor(meta.fields), ...inst.fields },
          options: { ...defaultsFor(meta.options), ...inst.options },
        }
      : { ...inst };
    if (inst.children?.length) {
      out.children = normalizeInstances(inst.children);
    }
    return out;
  });
}
