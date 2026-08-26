<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BlockMeta } from '@/api/pages';
import type { PageTemplate } from '@/api/page-templates';
import Icon from '@/components/Icon.vue';
import { toast } from '@/composables/useToast';
import { useAuthStore } from '@/stores/auth';

// Left rail of the dynamic builder. Two stacked sections:
//   1. Block Library — search box + chip-style category tabs + clickable /
//      draggable block cards. Click → emit add-block. dragstart payload format:
//      "library-block:<block_key>" so the canvas drop handler can tell this
//      from a placed-block reorder drag.
//   2. Saved Templates — merged list (code + user) from pageTemplatesApi.
//      Click → emit load-template. "+ Save current" → emit open-save-template.

const props = withDefaults(
  defineProps<{
    blockMetas: BlockMeta[];
    templates: PageTemplate[];
    templatesLoading: boolean;
    // The unified editor reuses just the block grid (templates live in the
    // top-bar dropdown there). Default false keeps the page builder unchanged.
    hideTemplates?: boolean;
  }>(),
  { hideTemplates: false },
);

const emit = defineEmits<{
  (e: 'add-block', key: string): void;
  (e: 'load-template', tpl: PageTemplate): void;
  (e: 'open-save-template'): void;
}>();

const search = ref('');
const activeCategory = ref<string>('All');

// Tabs are computed from the manifest itself — adding a new block with a new
// category surfaces the tab automatically. "All" stays pinned to the front.
const categories = computed<string[]>(() => {
  const seen = new Set<string>();
  for (const m of props.blockMetas) seen.add(m.category);
  return ['All', ...Array.from(seen).sort()];
});

const filteredBlocks = computed<BlockMeta[]>(() => {
  const q = search.value.trim().toLowerCase();
  return props.blockMetas.filter((m) => {
    if (activeCategory.value !== 'All' && m.category !== activeCategory.value) {
      return false;
    }
    if (!q) return true;
    return (
      m.label.toLowerCase().includes(q) ||
      (m.description ?? '').toLowerCase().includes(q) ||
      m.key.toLowerCase().includes(q)
    );
  });
});

function onLibraryDragStart(e: DragEvent, key: string): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', `library-block:${key}`);
}

// Mockup palette: each shipped category gets a stable accent color, and
// unknown categories fall through to a hash-based HSL so adding a new
// category doesn't require touching this file.
const CATEGORY_PALETTE: Record<string, { dot: string; bg: string; fg: string }> = {
  lead:    { dot: '#7C3AED', bg: '#EDE9FE', fg: '#5B21B6' },
  lists:   { dot: '#059669', bg: '#D1FAE5', fg: '#065F46' },
  feature: { dot: '#2563EB', bg: '#DBEAFE', fg: '#1E40AF' },
  metrics: { dot: '#D97706', bg: '#FEF3C7', fg: '#92400E' },
};
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
function categoryStyle(cat: string): { dot: string; bg: string; fg: string } {
  const known = CATEGORY_PALETTE[cat.toLowerCase()];
  if (known) return known;
  const hue = hashHue(cat);
  return {
    dot: `hsl(${hue}, 60%, 50%)`,
    bg: `hsl(${hue}, 60%, 92%)`,
    fg: `hsl(${hue}, 60%, 28%)`,
  };
}

// Public-site origin for the per-block "Preview" button. Comes from the
// /admin/auth/me session payload (auth.publicWebUrl is sourced from
// siteSettings.siteUrl); null = not configured.
const auth = useAuthStore();
const publicOrigin = computed<string | null>(() => {
  const fromAuth = auth.publicWebUrl;
  return fromAuth && fromAuth.length > 0
    ? fromAuth.replace(/\/$/, '')
    : null;
});

// CRITICAL: the entire .lib-block card is click-to-add AND draggable. Without
// both stopPropagation AND preventDefault here, clicking the Preview button
// silently fires the card's add-block handler too — editors would see the
// block appear on the canvas at the same moment the preview tab opens, which
// is exactly the confusing bug to avoid. The .stop.prevent modifiers on the
// template @click are belt-and-braces against future refactors that might
// drop the JS calls.
function onPreviewClick(e: MouseEvent, key: string): void {
  e.stopPropagation();
  e.preventDefault();
  const origin = publicOrigin.value;
  if (!origin) {
    toast.error(
      'Public site URL is not configured — set Site URL in Site Settings.',
    );
    return;
  }
  const url = `${origin}/preview/block/${encodeURIComponent(key)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <aside class="builder-library">
    <div class="lib-top">
      <div class="lib-heading">Block Library</div>
      <div class="lib-search">
        <Icon name="search" :size="12" />
        <input
          v-model="search"
          type="text"
          placeholder="Search blocks…"
        />
      </div>
      <div class="lib-tabs" role="tablist">
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          role="tab"
          :class="['ltab', { 'ltab--active': activeCategory === cat }]"
          :aria-selected="activeCategory === cat"
          @click="activeCategory = cat"
        >
          {{ cat }}
        </button>
      </div>
    </div>

    <div class="lib-scroll">
      <p v-if="filteredBlocks.length === 0" class="lib-empty">
        No blocks match
      </p>
      <div
        v-for="meta in filteredBlocks"
        :key="meta.key"
        class="lib-block"
        draggable="true"
        :title="`Click to add, or drag onto the canvas (${meta.key})`"
        @dragstart="onLibraryDragStart($event, meta.key)"
        @click="emit('add-block', meta.key)"
      >
        <div
          class="lb-dot"
          :style="{ background: categoryStyle(meta.category).dot }"
          aria-hidden="true"
        />
        <div class="lb-text">
          <div class="lb-name">{{ meta.label }}</div>
          <div v-if="meta.description" class="lb-desc">
            {{ meta.description }}
          </div>
          <div class="lb-footer">
            <span
              class="lb-tag"
              :style="{
                background: categoryStyle(meta.category).bg,
                color: categoryStyle(meta.category).fg,
              }"
            >{{ meta.category }}</span>
            <div class="lb-footer-right">
              <button
                type="button"
                class="lb-preview"
                :title="`Open a real render of ${meta.label} in a new tab`"
                draggable="false"
                @click.stop.prevent="onPreviewClick($event, meta.key)"
                @mousedown.stop
                @dragstart.stop.prevent
              >
                <Icon name="eye" :size="10" />
                Preview
              </button>
              <span class="lb-add">
                <Icon name="plus" :size="10" />
                Add
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!hideTemplates" class="lib-section-sep" />
    <div v-if="!hideTemplates" class="lib-section-row">
      <span class="lib-section-label">Saved Templates</span>
      <button
        type="button"
        class="lib-section-btn"
        title="Save the current canvas arrangement as a reusable template"
        @click="emit('open-save-template')"
      >+ Save current</button>
    </div>
    <div v-if="!hideTemplates" class="lib-saved-list">
      <p v-if="templatesLoading" class="lib-empty">Loading…</p>
      <p v-else-if="templates.length === 0" class="lib-empty">
        No templates yet — build a canvas and Save current.
      </p>
      <div
        v-for="t in templates"
        :key="t.key"
        class="saved-tpl"
        :title="`${t.blockKeys.length} block${t.blockKeys.length === 1 ? '' : 's'} — ${t.source === 'code' ? 'starter' : 'saved by your team'}`"
        @click="emit('load-template', t)"
      >
        <Icon name="layers" :size="14" class="saved-tpl-icon" />
        <div class="saved-tpl-body">
          <div class="saved-tpl-name">
            <span>{{ t.name }}</span>
            <span v-if="t.source === 'code'" class="saved-tpl-chip">STARTER</span>
          </div>
          <div class="saved-tpl-meta">
            {{ t.blockKeys.length }} block{{ t.blockKeys.length === 1 ? '' : 's' }}
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.builder-library {
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.lib-top {
  padding: 12px 12px 0;
  flex-shrink: 0;
}
.lib-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 8px;
}
.lib-search {
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 10px;
  margin-bottom: 8px;
  color: var(--text-tertiary);
}
.lib-search input {
  border: none;
  background: none;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--fg);
  outline: none;
  width: 100%;
}
.lib-search input::placeholder {
  color: var(--text-tertiary);
}

.lib-tabs {
  display: flex;
  gap: 3px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.ltab {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: none;
  color: var(--muted);
  font-family: inherit;
  transition: all 0.15s;
  text-transform: capitalize;
}
.ltab:hover {
  color: var(--fg);
}
.ltab--active {
  background: var(--fg);
  color: var(--surface);
}

.lib-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
  scrollbar-width: thin;
}
.lib-empty {
  padding: 16px 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
  margin: 0;
}

.lib-block {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 11px 12px;
  margin-bottom: 5px;
  cursor: grab;
  user-select: none;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.lib-block:hover {
  border-color: var(--info);
  background: var(--info-soft);
  transform: translateX(2px);
}
.lib-block:active {
  cursor: grabbing;
  opacity: 0.7;
}
.lb-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
}
.lb-text {
  flex: 1;
  min-width: 0;
}
.lb-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 2px;
}
.lb-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}
.lb-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}
.lb-tag {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 4px;
}
.lb-footer-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lb-add {
  font-size: 11px;
  font-weight: 600;
  color: var(--info);
  opacity: 0;
  transition: opacity 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.lib-block:hover .lb-add {
  opacity: 1;
}
/* Preview button — always visible (unlike the hover-only "+ Add") so editors
   discover it without hovering. Ghost styling keeps it secondary to the
   card's primary "click to add" affordance. */
.lb-preview {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.lb-preview:hover {
  background: var(--bg);
  color: var(--fg);
  border-color: var(--text-tertiary);
}

.lib-section-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 8px 8px;
  flex-shrink: 0;
}
.lib-section-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 6px;
  flex-shrink: 0;
}
.lib-section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.lib-section-btn {
  font-size: 11px;
  font-weight: 600;
  color: var(--info);
  cursor: pointer;
  background: none;
  border: none;
  font-family: inherit;
  padding: 2px 6px;
  border-radius: 4px;
}
.lib-section-btn:hover {
  background: var(--info-soft);
}

.lib-saved-list {
  padding: 0 8px 8px;
  max-height: 14rem;
  overflow-y: auto;
  scrollbar-width: thin;
  flex-shrink: 0;
}
.saved-tpl {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg);
  margin-bottom: 5px;
  transition: border-color 0.15s, background 0.15s;
}
.saved-tpl:hover {
  border-color: var(--purple);
  background: var(--purple-soft);
}
.saved-tpl-icon {
  color: var(--purple);
  flex-shrink: 0;
}
.saved-tpl-body {
  flex: 1;
  min-width: 0;
}
.saved-tpl-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 6px;
}
.saved-tpl-chip {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: var(--warning-soft);
  color: #92400e;
  padding: 1px 5px;
  border-radius: 3px;
}
.saved-tpl-meta {
  font-size: 10.5px;
  color: var(--text-tertiary);
}
</style>
