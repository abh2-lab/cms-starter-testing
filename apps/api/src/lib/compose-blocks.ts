import type { FastifyBaseLogger } from 'fastify';
import {
  getBlock,
  type Block,
  type BlockLoadContext,
  type PageBlockInstance,
  type PostBox,
  type TemplateBlock,
} from '@cms/blocks';

// ─── Shared, box-aware block-tree composer ────────────────────────────────
//
// One recursive walk used by every public render route (pages, content/single,
// archive). It generalises the old flat `safeLoad` + `Promise.all` that lived
// in public/pages.ts. Responsibilities:
//   - resolve each instance's block from the registry (injectable for tests);
//   - branch on meta.kind:
//       box        → resolveBoxes() → expand the per-item `children` template
//                    once per resolved box, with ctx.box set for descendants;
//       container  → render a wrapper + children, box passed through unchanged;
//       field/standalone → load(ctx) (field blocks project from ctx.box), then
//                    recurse children with the same ctx;
//   - degrade — never throw — on a missing block, a thrown loader, or a breached
//     safety cap, emitting a diagnostic `error` leaf the renderer can surface.
//
// The composed payload is cached by the calling route, so loaders must stay
// pure/idempotent (same contract as before).

export interface ComposedBlock {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  // Loader output. null when the loader threw OR the block is intentionally
  // empty (e.g. a hero with no story); `error` disambiguates.
  data: Record<string, unknown> | null;
  // Child subtree. OMITTED when empty so a flat page's composed output is
  // unchanged from the pre-nesting shape (a leaf carries no `children` key).
  // For a BOX block this is the flattened per-box expansion of its declared
  // item template. Renderers read `block.children ?? []`.
  children?: ComposedBlock[];
  // Set when the block_key is unknown, the loader rejected, or a safety cap was
  // hit. The renderer shows a placeholder (editors) / hides the slot (visitors).
  error?: 'load_failed' | 'unknown_block' | 'max_depth' | 'budget_exceeded';
}

// Safety caps. Block trees are partly tenant-authored today and fully so once
// the v2 visual editor lands, so a pathological/malicious tree (deep nesting,
// a 10k-count loop, nested loops) must never blow the stack, the event loop, or
// the DB. Each breach degrades to a diagnostic leaf instead of throwing.
export interface ComposeCaps {
  maxDepth: number; // deepest nesting level composed (root list = depth 0)
  maxBoxesPerLoop: number; // boxes a single box block may expand
  maxNodes: number; // total composed nodes per request
  maxHydrations: number; // summary→detail fetches per request (loop bodies)
}

export const DEFAULT_COMPOSE_CAPS: ComposeCaps = {
  maxDepth: 8,
  maxBoxesPerLoop: 50,
  maxNodes: 2000,
  maxHydrations: 12,
};

export interface ComposeOptions {
  // Block resolver — defaults to the live @cms/blocks registry. Injectable so
  // unit tests can compose against stub blocks without touching the registry.
  resolveBlock?: (key: string) => Block | undefined;
  caps?: Partial<ComposeCaps>;
}

type Logger = Pick<FastifyBaseLogger, 'warn'>;

// Mutable per-request budget, threaded through the recursion.
interface Budget {
  nodes: number;
  hydrations: number;
}

function shell(inst: PageBlockInstance): Pick<
  ComposedBlock,
  'id' | 'key' | 'fields' | 'options'
> {
  return {
    id: inst.id,
    key: inst.block_key,
    fields: inst.fields,
    options: inst.options,
  };
}

// Attach a budget-guarded hydrate() to a loop's summary box so a field block
// that needs detail (post-content, authors[]) can fetch THIS row on demand,
// capped per request. Detail boxes and boxes that already carry a hydrate are
// returned untouched.
function withHydrate(
  ctx: BlockLoadContext,
  box: PostBox,
  budget: Budget,
): PostBox {
  if (box.kind !== 'summary' || box.hydrate) return box;
  const { type, slug } = box.content;
  return {
    ...box,
    hydrate: async () => {
      if (budget.hydrations <= 0) return null;
      budget.hydrations -= 1;
      return ctx.fetchContent(type, slug);
    },
  };
}

/**
 * Convert a declarative template's blocks (TemplateBlock[], with default_fields/
 * default_options) into the PageBlockInstance[] the composer consumes. Ids are
 * deterministic by tree path so repeat renders are stable (safe Vue :key) — code
 * templates don't carry per-instance UUIDs the way saved pages do.
 */
export function instancesFromTemplate(
  blocks: TemplateBlock[],
  prefix = 'tpl',
): PageBlockInstance[] {
  return blocks.map((b, i) => {
    const id = `${prefix}-${i}`;
    const inst: PageBlockInstance = {
      id,
      block_key: b.block_key,
      fields: b.default_fields ?? {},
      options: b.default_options ?? {},
    };
    if (b.children?.length) {
      inst.children = instancesFromTemplate(b.children, id);
    }
    return inst;
  });
}

/**
 * Compose a (possibly nested) block-instance tree into a renderable
 * ComposedBlock tree. Never rejects: failures become `error` leaves.
 */
export async function composeBlocks(
  ctx: BlockLoadContext,
  instances: PageBlockInstance[],
  log: Logger,
  opts: ComposeOptions = {},
): Promise<ComposedBlock[]> {
  const resolveBlock = opts.resolveBlock ?? getBlock;
  const caps: ComposeCaps = { ...DEFAULT_COMPOSE_CAPS, ...opts.caps };
  const budget: Budget = {
    nodes: caps.maxNodes,
    hydrations: caps.maxHydrations,
  };
  return composeList(ctx, instances, 0, budget, caps, resolveBlock, log);
}

async function composeList(
  ctx: BlockLoadContext,
  instances: PageBlockInstance[],
  depth: number,
  budget: Budget,
  caps: ComposeCaps,
  resolveBlock: (key: string) => Block | undefined,
  log: Logger,
): Promise<ComposedBlock[]> {
  // Concurrent (preserves order via Promise.all) — matches the old flat
  // composer's fan-out so a page of N blocks issues its loader queries in
  // parallel, not serially. The synchronous budget prologue at the top of
  // composeOne runs in instance order during the .map, so node accounting is
  // deterministic within a level.
  return Promise.all(
    instances.map((inst) =>
      composeOne(ctx, inst, depth, budget, caps, resolveBlock, log),
    ),
  );
}

async function composeOne(
  ctx: BlockLoadContext,
  inst: PageBlockInstance,
  depth: number,
  budget: Budget,
  caps: ComposeCaps,
  resolveBlock: (key: string) => Block | undefined,
  log: Logger,
): Promise<ComposedBlock> {
  // Reserve a node up front (synchronous, before any await) so the budget is
  // consumed in pre-order and a runaway tree degrades predictably.
  if (budget.nodes <= 0) {
    return { ...shell(inst), data: null, error: 'budget_exceeded' };
  }
  budget.nodes -= 1;

  if (depth > caps.maxDepth) {
    return { ...shell(inst), data: null, error: 'max_depth' };
  }

  const block = resolveBlock(inst.block_key);
  if (!block) {
    log.warn(
      { block_key: inst.block_key },
      'composer: unknown block_key (dropped from manifest?)',
    );
    return { ...shell(inst), data: null, error: 'unknown_block' };
  }

  const kind = block.meta.kind ?? 'standalone';

  if (kind === 'box') {
    return composeBox(ctx, inst, block, depth, budget, caps, resolveBlock, log);
  }

  // standalone | field | container — run the loader, then recurse children
  // with the SAME context (the box, if any, passes straight through).
  let data: Record<string, unknown> | null = null;
  let error: ComposedBlock['error'];
  try {
    data =
      (await block.load(ctx, {
        fields: inst.fields,
        options: inst.options,
      })) ?? null;
  } catch (err) {
    log.warn({ err, block_key: inst.block_key }, 'composer: block loader threw');
    error = 'load_failed';
  }

  const children = inst.children?.length
    ? await composeList(ctx, inst.children, depth + 1, budget, caps, resolveBlock, log)
    : [];

  const out: ComposedBlock = { ...shell(inst), data };
  if (children.length) out.children = children;
  if (error) out.error = error;
  return out;
}

// Every box expands the SAME item template, so without intervention each
// box's subtree would repeat the template's instance ids — duplicate Vue
// :key values in BlockTree once a loop resolves >1 box, and ambiguous
// targets for editor tooling that maps a rendered node back to an instance.
// Suffix the box ordinal onto every id in the box's subtree: `tpl-1-0@3`
// still PREFIXES the authored instance id, so a consumer can recover it by
// splitting on '@' (nested loops suffix again — `…@0@2` — still unique).
function withBoxIds(
  instances: PageBlockInstance[],
  boxIdx: number,
): PageBlockInstance[] {
  return instances.map((inst) => {
    const out: PageBlockInstance = { ...inst, id: `${inst.id}@${boxIdx}` };
    if (inst.children?.length) {
      out.children = withBoxIds(inst.children, boxIdx);
    }
    return out;
  });
}

async function composeBox(
  ctx: BlockLoadContext,
  inst: PageBlockInstance,
  block: Block,
  depth: number,
  budget: Budget,
  caps: ComposeCaps,
  resolveBlock: (key: string) => Block | undefined,
  log: Logger,
): Promise<ComposedBlock> {
  if (!block.resolveBoxes) {
    log.warn(
      { block_key: inst.block_key },
      "composer: block kind 'box' but no resolveBoxes()",
    );
    return { ...shell(inst), data: null, error: 'load_failed' };
  }

  let boxes: PostBox[];
  try {
    boxes =
      (await block.resolveBoxes(ctx, {
        fields: inst.fields,
        options: inst.options,
      })) ?? [];
  } catch (err) {
    log.warn(
      { err, block_key: inst.block_key },
      'composer: resolveBoxes threw',
    );
    return { ...shell(inst), data: null, error: 'load_failed' };
  }

  const capped = boxes.slice(0, caps.maxBoxesPerLoop);
  // The box block's declared `children` ARE the per-item template. Expand them
  // once per resolved box (box set on the child context) and flatten so the
  // renderer just walks children in order.
  const itemTemplate = inst.children ?? [];
  const groups = await Promise.all(
    capped.map((box, boxIdx) => {
      const childCtx: BlockLoadContext = {
        ...ctx,
        box: withHydrate(ctx, box, budget),
      };
      return composeList(
        childCtx,
        withBoxIds(itemTemplate, boxIdx),
        depth + 1,
        budget,
        caps,
        resolveBlock,
        log,
      );
    }),
  );

  const out: ComposedBlock = { ...shell(inst), data: null };
  const flat = groups.flat();
  if (flat.length) out.children = flat;
  return out;
}
