import { provide, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { BlockMeta, PageBlockInstance } from '@/api/pages';
import { buildInstance } from '@/lib/block-instance';

// One mutation surface over a single `blocks` tree ref, shared by the
// structure popup (nested, ↑/↓) and the flat "Current blocks" list (drag).
// Because both bind to the SAME ref through this one API, a reorder in either
// place is reflected in the other automatically — no copies, no reconciliation.
//
// Paths are child-index chains from the root: [2, 0] = third root block's
// first child. All ops are immutable clone-along-path updates, so Vue sees a
// fresh array reference (keeps the dirty-watch + preview-refresh honest).

export type TreePath = number[];

export interface BlockTreeApi {
  metaByKey: ComputedRef<Map<string, BlockMeta>>;
  updateFields(path: TreePath, values: Record<string, unknown>): void;
  updateOptions(path: TreePath, values: Record<string, unknown>): void;
  move(path: TreePath, dir: -1 | 1): void;
  remove(path: TreePath): void;
  addChild(path: TreePath, blockKey: string): void;
  addRoot(blockKey: string): void;
  moveRoot(from: number, to: number): void;
  // The content-type slug a field block at `path` operates on — the nearest
  // ANCESTOR box block's `content_type` option. Powers the custom-field picker
  // (which lists that type's custom fields). Null when no box ancestor sets one.
  resolveAncestorContentType(path: TreePath): string | null;
}

export const BLOCK_TREE_KEY: InjectionKey<BlockTreeApi> = Symbol('block-tree');

function cloneAlong(
  roots: PageBlockInstance[],
  parentPath: TreePath,
): { next: PageBlockInstance[]; parentList: PageBlockInstance[] } {
  const next = roots.slice();
  let list = next;
  for (const idx of parentPath) {
    const node = list[idx];
    if (!node) return { next, parentList: list };
    const cloned: PageBlockInstance = {
      ...node,
      children: (node.children ?? []).slice(),
    };
    list[idx] = cloned;
    list = cloned.children!;
  }
  return { next, parentList: list };
}

export function useBlockTree(
  blocks: Ref<PageBlockInstance[]>,
  metaByKey: ComputedRef<Map<string, BlockMeta>>,
): BlockTreeApi {
  function patchNode(
    path: TreePath,
    patch: (node: PageBlockInstance) => PageBlockInstance,
  ): void {
    const parentPath = path.slice(0, -1);
    const idx = path[path.length - 1]!;
    const { next, parentList } = cloneAlong(blocks.value, parentPath);
    const node = parentList[idx];
    if (!node) return;
    parentList[idx] = patch(node);
    blocks.value = next;
  }

  const api: BlockTreeApi = {
    metaByKey,
    updateFields(path, values) {
      patchNode(path, (n) => ({ ...n, fields: values }));
    },
    updateOptions(path, values) {
      patchNode(path, (n) => ({ ...n, options: values }));
    },
    move(path, dir) {
      const parentPath = path.slice(0, -1);
      const idx = path[path.length - 1]!;
      const { next, parentList } = cloneAlong(blocks.value, parentPath);
      const target = idx + dir;
      if (target < 0 || target >= parentList.length) return;
      const [moved] = parentList.splice(idx, 1);
      if (!moved) return;
      parentList.splice(target, 0, moved);
      blocks.value = next;
    },
    remove(path) {
      const parentPath = path.slice(0, -1);
      const idx = path[path.length - 1]!;
      const { next, parentList } = cloneAlong(blocks.value, parentPath);
      parentList.splice(idx, 1);
      blocks.value = next;
    },
    addChild(path, blockKey) {
      const inst = buildInstance(metaByKey.value.get(blockKey));
      if (!inst) return;
      const { next, parentList } = cloneAlong(blocks.value, path.slice(0, -1));
      const idx = path[path.length - 1]!;
      const node = parentList[idx];
      if (!node) return;
      parentList[idx] = { ...node, children: [...(node.children ?? []), inst] };
      blocks.value = next;
    },
    addRoot(blockKey) {
      const inst = buildInstance(metaByKey.value.get(blockKey));
      if (!inst) return;
      blocks.value = [...blocks.value, inst];
    },
    moveRoot(from, to) {
      if (from === to) return;
      const next = blocks.value.slice();
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      blocks.value = next;
    },
    resolveAncestorContentType(path) {
      let list = blocks.value;
      let found: string | null = null;
      // Walk the ancestor chain (exclude the node itself); the NEAREST box's
      // content_type wins, so a custom-field block reflects the box it's in.
      for (const idx of path.slice(0, -1)) {
        const node = list[idx];
        if (!node) break;
        const meta = metaByKey.value.get(node.block_key);
        if (meta?.kind === 'box') {
          const ct = node.options?.['content_type'];
          if (typeof ct === 'string' && ct.length > 0) found = ct;
        }
        list = node.children ?? [];
      }
      return found;
    },
  };

  provide(BLOCK_TREE_KEY, api);
  return api;
}
