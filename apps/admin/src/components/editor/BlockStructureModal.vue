<script setup lang="ts">
import { ref } from 'vue';
import type { PageBlockInstance } from '@/api/pages';
import Icon from '@/components/Icon.vue';
import EditorTreeNode from './EditorTreeNode.vue';

// The structure popup: a FLOATING, drag-anywhere panel (not a fixed overlay)
// with a minimize toggle, so the admin can shrink it to see the reload-only
// preview in full, then bring it back. It renders the block tree (root
// EditorTreeNodes); the mutation API (useBlockTree) and UI state (editor-ui)
// are provided by the parent BlocksEditor, so the popup and the left
// "Current blocks" list edit the SAME tree and stay in sync.

defineProps<{
  blocks: PageBlockInstance[];
  title: string;
}>();

const open = defineModel<boolean>('open', { required: true });
const minimized = defineModel<boolean>('minimized', { required: true });

// ── Drag-anywhere (pointer-based; panel position as a fixed offset) ──────────
// The panel root, so we can measure its on-screen rect and keep it fully inside
// the viewport while dragging.
const panel = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });
let dragging = false;
let start = { px: 0, py: 0, ox: 0, oy: 0 };
// The panel's rect captured at drag start (it already includes the current
// transform), so we clamp the drag *delta* against it rather than re-deriving
// the top/right CSS anchor.
let startRect: DOMRect | null = null;
const EDGE_GAP = 8; // keep at least this many px between the panel and each edge

function onHeaderDown(e: PointerEvent): void {
  // Ignore drags that start on a header button.
  if ((e.target as HTMLElement).closest('button')) return;
  dragging = true;
  start = { px: e.clientX, py: e.clientY, ox: pos.value.x, oy: pos.value.y };
  startRect = panel.value?.getBoundingClientRect() ?? null;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onHeaderMove(e: PointerEvent): void {
  if (!dragging) return;
  let dx = e.clientX - start.px;
  let dy = e.clientY - start.py;
  // Clamp so the whole card stays on screen — it can no longer be dragged past
  // an edge and lost. new left = startRect.left + dx, new right = startRect.right
  // + dx, etc.; keep both within [EDGE_GAP, viewport - EDGE_GAP]. If the panel is
  // bigger than the viewport on an axis, pin its top/left edge visible instead.
  if (startRect) {
    const minDx = EDGE_GAP - startRect.left;
    const maxDx = window.innerWidth - EDGE_GAP - startRect.right;
    const minDy = EDGE_GAP - startRect.top;
    const maxDy = window.innerHeight - EDGE_GAP - startRect.bottom;
    dx = maxDx >= minDx ? Math.min(Math.max(dx, minDx), maxDx) : minDx;
    dy = maxDy >= minDy ? Math.min(Math.max(dy, minDy), maxDy) : minDy;
  }
  pos.value = { x: start.ox + dx, y: start.oy + dy };
}
function onHeaderUp(e: PointerEvent): void {
  dragging = false;
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
}
</script>

<template>
  <div
    v-if="open"
    ref="panel"
    class="bsm"
    :class="{ 'bsm--min': minimized }"
    :style="{ transform: `translate(${pos.x}px, ${pos.y}px)` }"
  >
    <header
      class="bsm-head"
      @pointerdown="onHeaderDown"
      @pointermove="onHeaderMove"
      @pointerup="onHeaderUp"
    >
      <Icon name="layers" :size="13" class="bsm-grip" />
      <span class="bsm-title">{{ title }}</span>
      <div class="bsm-actions">
        <button
          type="button"
          class="bsm-iconbtn"
          :title="minimized ? 'Expand' : 'Minimize'"
          @click="minimized = !minimized"
        >
          <Icon :name="minimized ? 'maximize' : 'minus'" :size="13" />
        </button>
        <button
          type="button"
          class="bsm-iconbtn"
          title="Close"
          @click="open = false"
        >
          <Icon name="x" :size="13" />
        </button>
      </div>
    </header>

    <div v-if="!minimized" class="bsm-body">
      <p v-if="blocks.length === 0" class="bsm-empty">
        No blocks yet — add one from the Library on the left.
      </p>
      <EditorTreeNode
        v-for="(block, idx) in blocks"
        :key="block.id"
        :block="block"
        :path="[idx]"
        :total="blocks.length"
      />
    </div>
  </div>
</template>

<style scoped>
.bsm {
  position: fixed;
  top: 84px;
  right: 24px;
  width: 380px;
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  background: var(--card-bg, var(--surface));
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px -12px rgba(0, 0, 0, 0.35);
  z-index: 80;
  overflow: hidden;
}
.bsm--min {
  max-height: none;
}
.bsm-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.bsm-head:active {
  cursor: grabbing;
}
.bsm-grip {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.bsm-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  flex: 1;
}
.bsm-actions {
  display: flex;
  gap: 2px;
}
.bsm-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: none;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
}
.bsm-iconbtn:hover {
  background: var(--bg, #f3f4f6);
  color: var(--fg, #111);
}
.bsm-body {
  padding: 12px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.bsm-empty {
  margin: 0;
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
