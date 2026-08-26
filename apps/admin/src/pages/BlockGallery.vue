<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { blocksApi, type BlockMeta } from '@/api/pages';
import Icon from '@/components/Icon.vue';
import { useAuthStore } from '@/stores/auth';

// Block Gallery — a visual catalogue of every block the theme ships. Each card
// shows a live preview (rendered on the real public site, iframed) plus the
// block's name, key, category tag, and description, so an admin can recognise
// a block by sight instead of guessing from a name in the editor's library.
//
// Previews are best-effort: standalone + field blocks render (field blocks via
// a sample post — see the /blocks/:key/preview API); container/box blocks are
// structural and show a "No preview" card. Iframes load LAZILY (only when
// scrolled into view) so opening the page doesn't spin up a Nuxt render for
// every block at once.

const auth = useAuthStore();
const router = useRouter();
const publicOrigin = computed<string | null>(() => {
  const u = auth.publicWebUrl;
  return u && u.length > 0 ? u.replace(/\/$/, '') : null;
});

const blocks = ref<BlockMeta[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const search = ref('');
const activeCategory = ref('All');

onMounted(async () => {
  try {
    const res = await blocksApi.list();
    blocks.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load blocks';
  } finally {
    loading.value = false;
  }
});

const categories = computed<string[]>(() => {
  const seen = new Set<string>();
  for (const b of blocks.value) seen.add(b.category);
  return ['All', ...Array.from(seen).sort()];
});

const filtered = computed<BlockMeta[]>(() => {
  const q = search.value.trim().toLowerCase();
  return blocks.value.filter((b) => {
    if (activeCategory.value !== 'All' && b.category !== activeCategory.value) {
      return false;
    }
    if (!q) return true;
    return (
      b.label.toLowerCase().includes(q) ||
      b.key.toLowerCase().includes(q) ||
      (b.description ?? '').toLowerCase().includes(q)
    );
  });
});

// A block previews in isolation only when it's standalone (self-sufficient) or
// field (rendered against a sample post). Container/box are structural.
function previewable(b: BlockMeta): boolean {
  const kind = b.kind ?? 'standalone';
  return kind === 'standalone' || kind === 'field';
}

// Split the catalogue: previewable blocks get full cards with a live iframe;
// structural (no-preview) blocks get compact cards packed 3-per-row, so they
// don't waste a wide slot on a "No preview" placeholder.
const previewBlocks = computed<BlockMeta[]>(() =>
  filtered.value.filter((b) => previewable(b)),
);
const noPreviewBlocks = computed<BlockMeta[]>(() =>
  filtered.value.filter((b) => !previewable(b)),
);

// Per-block iframe load state, so each card shows a spinner until its preview
// finishes loading instead of a blank frame. Keyed by block key.
const iframeLoaded = ref<Record<string, boolean>>({});
function onIframeLoad(key: string): void {
  iframeLoaded.value = { ...iframeLoaded.value, [key]: true };
}
// Each preview is an iframe to the public /preview/block/:key route. We rely
// on the native iframe `loading="lazy"` attribute to defer off-screen frames
// rather than a manual IntersectionObserver — simpler and it survives the
// admin's scroll-container layout.
function previewSrc(b: BlockMeta): string | null {
  if (!publicOrigin.value || !previewable(b)) return null;
  // ?embed=1 renders the block alone (no "Preview" header strip) so the whole
  // frame shows the block — see preview/block/[key].vue.
  return `${publicOrigin.value}/preview/block/${encodeURIComponent(b.key)}?embed=1`;
}

// Per-block preview content heights, reported by each embed iframe over
// postMessage (see preview/block/[key].vue). Lets a frame size itself to its
// block instead of a fixed height that left white space under short blocks.
const previewHeights = ref<Record<string, number>>({});

const MIN_FRAME = 120;
const MAX_FRAME = 680;
const DEFAULT_FRAME = 300;

function onPreviewMessage(e: MessageEvent): void {
  // Only trust height reports from the public site origin (the iframe source).
  if (!publicOrigin.value || e.origin !== publicOrigin.value) return;
  const d = e.data as { type?: unknown; key?: unknown; height?: unknown } | null;
  if (
    !d ||
    d.type !== 'cms-block-preview-size' ||
    typeof d.key !== 'string' ||
    typeof d.height !== 'number' ||
    !Number.isFinite(d.height)
  ) {
    return;
  }
  previewHeights.value = { ...previewHeights.value, [d.key]: d.height };
}

onMounted(() => window.addEventListener('message', onPreviewMessage));
onBeforeUnmount(() => window.removeEventListener('message', onPreviewMessage));

// Visible (scaled) height of a card's preview frame. The iframe renders at a
// desktop viewport width (200% of the card) scaled to 0.5, so the visible
// height is half the reported content height — clamped so a tiny block still
// reads and a giant one doesn't dominate the grid. Falls back to a default
// until the iframe reports its height.
function frameHeight(b: BlockMeta): number {
  const content = previewHeights.value[b.key];
  const visible = content ? content * 0.5 : DEFAULT_FRAME;
  return Math.round(Math.min(MAX_FRAME, Math.max(MIN_FRAME, visible)));
}

// A block is editable when it has copy fields and/or data-source options. The
// "Edit" button opens the block-defaults editor; structural blocks with no
// fields/options (group, query-loop) don't get one.
function editable(b: BlockMeta): boolean {
  return b.fields.length > 0 || b.options.length > 0;
}
function editBlock(b: BlockMeta): void {
  void router.push({ name: 'block-edit-default', params: { key: b.key } });
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1 class="page-title">Block Gallery</h1>
        <div class="page-subtitle">
          Every block your theme ships, with a live preview — browse here, then
          add by name in the editor.
        </div>
      </div>
    </div>

    <div v-if="error" class="bg-banner bg-banner--error">{{ error }}</div>
    <div v-else-if="loading" class="bg-banner">Loading blocks…</div>

    <template v-else>
      <div class="bg-toolbar">
        <label class="bg-search">
          <Icon name="search" :size="13" />
          <input
            v-model="search"
            type="text"
            placeholder="Search blocks…"
          />
        </label>
        <div class="bg-tabs">
          <button
            v-for="cat in categories"
            :key="cat"
            type="button"
            :class="['bg-tab', { 'bg-tab--active': activeCategory === cat }]"
            @click="activeCategory = cat"
          >{{ cat }}</button>
        </div>
      </div>

      <div v-if="!publicOrigin" class="bg-banner">
        Set your Site URL in Site Settings to load live block previews.
      </div>

      <div v-if="previewBlocks.length" class="bg-grid">
        <article v-for="b in previewBlocks" :key="b.key" class="bg-card">
          <div class="bg-preview" :style="{ height: frameHeight(b) + 'px' }">
            <template v-if="previewSrc(b)">
              <div v-if="!iframeLoaded[b.key]" class="bg-preview-loading">
                <div class="spinner"></div>
              </div>
              <iframe
                class="bg-iframe"
                :src="previewSrc(b)!"
                :title="`Preview of ${b.label}`"
                loading="lazy"
                :style="{ height: frameHeight(b) * 2 + 'px' }"
                @load="onIframeLoad(b.key)"
              />
            </template>
            <div v-else class="bg-preview-pending">
              <Icon name="eye" :size="16" />
            </div>
          </div>
          <div class="bg-meta">
            <div class="bg-name-row">
              <span class="bg-name">{{ b.label }}</span>
              <span class="bg-cat">{{ b.category }}</span>
            </div>
            <code class="bg-key">{{ b.key }}</code>
            <p v-if="b.description" class="bg-desc">{{ b.description }}</p>
            <button
              v-if="editable(b)"
              type="button"
              class="bg-edit"
              @click="editBlock(b)"
            >
              <Icon name="edit" :size="12" /> Edit defaults
            </button>
          </div>
        </article>
      </div>

      <template v-if="noPreviewBlocks.length">
        <h2 class="bg-section-title">Structural blocks</h2>
        <div class="bg-grid bg-grid--compact">
          <article
            v-for="b in noPreviewBlocks"
            :key="b.key"
            class="bg-card bg-card--compact"
          >
            <div class="bg-meta">
              <div class="bg-name-row">
                <span class="bg-name">{{ b.label }}</span>
                <span class="bg-cat">{{ b.category }}</span>
              </div>
              <code class="bg-key">{{ b.key }}</code>
              <p v-if="b.description" class="bg-desc">{{ b.description }}</p>
              <button
                v-if="editable(b)"
                type="button"
                class="bg-edit"
                @click="editBlock(b)"
              >
                <Icon name="edit" :size="12" /> Edit defaults
              </button>
            </div>
          </article>
        </div>
      </template>

      <p v-if="filtered.length === 0" class="bg-empty">No blocks match.</p>
    </template>
  </section>
</template>

<style scoped>
.bg-banner {
  padding: 10px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 14px;
}
.bg-banner--error {
  border-color: #fecaca;
  background: var(--danger-soft);
  color: var(--danger);
}
.bg-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.bg-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-tertiary);
  min-width: 220px;
}
.bg-search input {
  border: none;
  background: none;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--fg, #111);
  width: 100%;
}
.bg-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.bg-tab {
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
}
.bg-tab--active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
/* Two columns so each preview is wide enough to read the block clearly. The
   iframe renders the public site at a desktop viewport width (200% of the
   card) and scales it to half, so a wide card shows a faithful, legible
   miniature. Collapses to a single column on narrow admin viewports. */
.bg-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  /* Don't stretch a short card to its row-mate's height — each card takes its
     natural height so the preview frame fits its block with no white space. */
  align-items: start;
}
/* No-preview blocks are small text cards, so pack them 3-per-row → 2 → 1. The
   compact rule comes AFTER the base 2-col rule so it wins for compact grids;
   the responsive overrides below come after the base @media so they win too. */
.bg-grid--compact {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 900px) {
  .bg-grid {
    grid-template-columns: 1fr;
  }
  .bg-grid--compact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .bg-grid--compact {
    grid-template-columns: 1fr;
  }
}
.bg-section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary, var(--muted));
  margin: 28px 0 12px;
}
.bg-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.15s;
}
.bg-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
.bg-preview {
  /* height is set inline per-block from the iframe's reported content height
     (frameHeight) — defaults until the frame reports, then animates to fit. */
  background: #fafafa;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  position: relative;
  transition: height 0.18s ease;
}
.bg-iframe {
  width: 200%;
  /* height is set inline per-block (= frameHeight * 2, scaled to 0.5). */
  border: none;
  transform: scale(0.5);
  transform-origin: top left;
  pointer-events: none;
  background: #fff;
}
.bg-preview-pending {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}
/* Spinner overlay — covers the frame until the iframe fires `load`, so a card
   never shows a blank white box while its preview renders. */
.bg-preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
  z-index: 1;
}
.bg-meta {
  padding: 12px 14px;
}
.bg-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bg-name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--fg, #111);
}
.bg-cat {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
  flex-shrink: 0;
}
.bg-key {
  display: block;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 3px;
}
.bg-desc {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
  margin: 6px 0 0;
}
.bg-edit {
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}
.bg-edit:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.bg-empty {
  font-size: 13px;
  color: var(--text-tertiary);
  padding: 24px 0;
  text-align: center;
}
</style>
