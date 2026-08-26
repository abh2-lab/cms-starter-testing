import type { ComposedBlock } from '~/composables/useBlockRegistry';

// Region slicing for view-level templates (theme engine v1.5).
//
// A view template is ONE composed tree, but a view's layout has several
// slots (the category page's sticky sidebar vs its article column; the tag
// page's full-width hero vs its grid section). Top-level template blocks
// carry `region` in their options; the owning view buckets the roots and
// places each bucket into its slot. Missing/unknown regions land in 'main'
// so a malformed (future) override can never lose content — it can only
// render it in the main column.
export function splitBlocksByRegion(
  blocks: ComposedBlock[] | null | undefined,
): Record<string, ComposedBlock[]> {
  const out: Record<string, ComposedBlock[]> = {};
  for (const b of blocks ?? []) {
    const raw = b.options['region'];
    const region = typeof raw === 'string' && raw.length > 0 ? raw : 'main';
    (out[region] ??= []).push(b);
  }
  return out;
}
