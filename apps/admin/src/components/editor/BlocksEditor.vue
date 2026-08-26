<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '@/components/Icon.vue';
import SaveTemplateDialog from '@/components/builder/SaveTemplateDialog.vue';
import EditorLeftPanel from './EditorLeftPanel.vue';
import BlockStructureModal from './BlockStructureModal.vue';
import { useBlockTree } from './useBlockTree';
import { EDITOR_UI_KEY } from './editor-ui';
import { usePageEditorAdapter } from '@/composables/usePageEditorAdapter';
import { useThemeEditorMode } from '@/composables/useThemeEditorMode';
import type { BlockMeta } from '@/api/pages';
import type { EditorAdapter, EditorRevision } from './editor-adapter';

// The one unified blocks editor. A THIN shell over two per-mode composables
// (page vs template/part) — it never branches on mode for load/save/preview,
// it just drives whichever EditorAdapter the route resolves. Layout: left
// two-tab panel (Library + flat Blocks list) | centre LIVE PREVIEW (scoped to
// what's being edited) | floating, minimizable structure popup.

// The thin route wrappers pass `mode` and a :key on the route param, so this
// component re-mounts cleanly when the edited entity changes (the composables
// capture their id/key at setup). `mode` falls back to the route name for
// direct use.
const props = defineProps<{ mode?: 'page' | 'theme' }>();
const route = useRoute();
const isPage = (props.mode ?? (route.name === 'page-edit-dynamic' ? 'page' : 'theme')) === 'page';

// One of the two composables runs for this component's lifetime, so the
// conditional call is safe.
const editor: EditorAdapter = isPage
  ? usePageEditorAdapter()
  : useThemeEditorMode(String(route.params['key'] ?? ''));

const metaByKey = computed<Map<string, BlockMeta>>(() => {
  const m = new Map<string, BlockMeta>();
  for (const meta of editor.blockMetas.value) m.set(meta.key, meta);
  return m;
});

// Shared mutation API (provided to the popup tree + the left list).
useBlockTree(editor.blocks, metaByKey);

// ── Popup + focus UI ─────────────────────────────────────────────────────────
const modalOpen = ref(true);
const modalMinimized = ref(false);
const expandedId = ref<string | null>(null);
const focusedId = ref<string | null>(null);
provide(EDITOR_UI_KEY, {
  expandedId,
  focusedId,
  focus(id: string) {
    focusedId.value = id;
    expandedId.value = id;
    modalOpen.value = true;
    modalMinimized.value = false;
  },
});

// ── Scoped live preview (reload-only) ────────────────────────────────────────
const previewBump = ref(0);
async function reloadPreview(): Promise<void> {
  await editor.refreshPreview();
  previewBump.value += 1;
}

// ── Top-bar actions ──────────────────────────────────────────────────────────
async function onSave(): Promise<void> {
  await editor.save();
  // editor.save() already re-issued the preview token; bump to reload.
  previewBump.value += 1;
}

// Page-only title/slug proxies (present iff caps.titleSlug).
const titleModel = computed({
  get: () => editor.title?.value ?? '',
  set: (v: string) => {
    if (editor.title) editor.title.value = v;
  },
});
const slugModel = computed({
  get: () => editor.slug?.value ?? '',
  set: (v: string) => {
    if (editor.slug) editor.slug.value = v;
  },
});

function onPickTemplate(e: Event): void {
  const key = (e.target as HTMLSelectElement).value;
  if (key && editor.applyTemplate) void editor.applyTemplate(key);
  (e.target as HTMLSelectElement).value = '';
}

// Save-as-template dialog (page mode).
const saveTplOpen = ref(false);
const rootBlockKeys = computed(() => editor.blocks.value.map((b) => b.block_key));

// Revisions panel.
const revisionsOpen = ref(false);
const revisions = ref<EditorRevision[]>([]);
async function toggleRevisions(): Promise<void> {
  revisionsOpen.value = !revisionsOpen.value;
  if (revisionsOpen.value && editor.listRevisions) {
    revisions.value = await editor.listRevisions();
  }
}

const backTo = computed(() =>
  isPage ? { name: 'pages' } : { name: 'theme-settings' },
);
const backLabel = computed(() => (isPage ? 'Pages' : 'Theme Settings'));

// Why Publish is disabled (an already-published page can't be re-published;
// a template/part needs a saved draft first). Shown as the button's tooltip.
const publishTitle = computed(() => {
  if (editor.canPublish.value) return 'Publish';
  return isPage
    ? 'Already published — Save updates the live page.'
    : 'Save a draft first, then Publish makes it live.';
});
</script>

<template>
  <div class="be">
    <header class="be-top">
      <RouterLink class="be-back" :to="backTo">
        <Icon name="chevron-left" :size="13" />
        {{ backLabel }}
      </RouterLink>

      <template v-if="editor.caps.titleSlug">
        <input
          v-model="titleModel"
          class="be-title-input"
          placeholder="Page title"
        />
        <span class="be-slug">/<input v-model="slugModel" class="be-slug-input" /></span>
      </template>
      <template v-else>
        <strong class="be-name">{{ editor.headerName.value }}</strong>
        <code class="be-key">{{ editor.headerKey.value }}</code>
      </template>

      <span v-if="editor.statusLabel.value" class="be-status">
        {{ editor.statusLabel.value }}
      </span>
      <span v-if="editor.dirty.value" class="be-chip be-chip--dirty">Unsaved</span>

      <div class="be-actions">
        <select
          v-if="editor.caps.templatePicker"
          class="be-tpl-select"
          @change="onPickTemplate"
        >
          <option value="">Template…</option>
          <option
            v-for="t in editor.templateOptions?.value ?? []"
            :key="t.key"
            :value="t.key"
          >
            {{ t.name }} ({{ t.source === 'code' ? 'starter' : 'mine' }})
          </option>
        </select>
        <button
          v-if="editor.caps.saveAsTemplate"
          type="button"
          class="be-btn"
          :disabled="rootBlockKeys.length === 0"
          @click="saveTplOpen = true"
        >Save as template</button>
        <button
          v-if="!modalOpen"
          type="button"
          class="be-btn"
          @click="modalOpen = true"
        >Structure</button>
        <button
          v-if="editor.caps.revisions"
          type="button"
          class="be-btn"
          @click="toggleRevisions"
        >Revisions</button>
        <button
          v-if="editor.caps.discardDraft"
          type="button"
          class="be-btn"
          :disabled="editor.busy.value"
          @click="editor.discardDraft && editor.discardDraft()"
        >Discard draft</button>
        <button
          v-if="editor.caps.reset"
          type="button"
          class="be-btn be-btn--danger"
          :disabled="editor.busy.value"
          @click="editor.reset && editor.reset()"
        >Reset</button>
        <button
          type="button"
          class="be-btn be-btn--primary"
          :disabled="editor.busy.value || !editor.dirty.value"
          @click="onSave"
        >{{ editor.saveLabel.value }}</button>
        <button
          v-if="editor.caps.publish"
          type="button"
          class="be-btn be-btn--publish"
          :disabled="editor.busy.value || !editor.canPublish.value"
          :title="publishTitle"
          @click="editor.publish"
        >Publish</button>
      </div>
    </header>

    <div v-if="revisionsOpen" class="be-revisions">
      <strong>History</strong>
      <span v-if="revisions.length === 0" class="be-rev-empty">No revisions yet.</span>
      <div v-for="r in revisions" :key="r.revisionNumber" class="be-rev-row">
        <span>#{{ r.revisionNumber }}</span>
        <span class="be-rev-date">{{ new Date(r.createdAt).toLocaleString() }}</span>
        <button
          v-if="editor.restoreRevision"
          type="button"
          class="be-btn"
          @click="editor.restoreRevision(r.revisionNumber)"
        >Restore to draft</button>
      </div>
    </div>

    <div v-if="editor.loadError.value" class="be-banner be-banner--error">
      {{ editor.loadError.value }}
    </div>
    <div v-else-if="editor.loading.value" class="be-loading">Loading…</div>

    <div v-else class="be-grid">
      <EditorLeftPanel
        :blocks="editor.blocks.value"
        :block-metas="editor.blockMetas.value"
      />

      <section class="be-preview">
        <div class="be-preview-bar">
          <span>Live preview</span>
          <button type="button" class="be-btn" @click="reloadPreview">
            {{ editor.previewUrl.value ? 'Reload' : 'Open preview' }}
          </button>
          <a
            v-if="editor.previewUrl.value"
            class="be-btn"
            :href="editor.previewUrl.value"
            target="_blank"
            rel="noopener noreferrer"
          >↗</a>
        </div>
        <div v-if="editor.previewError.value" class="be-banner be-banner--error">
          {{ editor.previewError.value }}
        </div>
        <iframe
          v-if="editor.previewUrl.value"
          :key="previewBump"
          class="be-iframe"
          :src="editor.previewUrl.value"
          title="Live preview"
        />
        <div v-else class="be-preview-empty">
          Save a draft (or hit Open preview) to load the live site here with
          your draft applied.
        </div>
      </section>
    </div>

    <BlockStructureModal
      v-model:open="modalOpen"
      v-model:minimized="modalMinimized"
      :blocks="editor.blocks.value"
      :title="`Structure — ${editor.headerName.value}`"
    />

    <SaveTemplateDialog
      :open="saveTplOpen"
      :block-keys="rootBlockKeys"
      @close="saveTplOpen = false"
      @saved="saveTplOpen = false"
    />
  </div>
</template>

<style scoped>
.be {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.be-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.be-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-decoration: none;
}
.be-back:hover {
  color: var(--fg, #111);
}
.be-name {
  font-size: 14px;
}
.be-key,
.be-slug {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.be-title-input {
  font-size: 14px;
  font-weight: 700;
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 4px 8px;
  background: var(--surface-2);
  color: var(--fg, #111);
  font-family: inherit;
}
.be-title-input:focus {
  outline: none;
  border-color: var(--accent);
}
.be-slug {
  display: inline-flex;
  align-items: center;
}
.be-slug-input {
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 3px 6px;
  background: var(--surface-2);
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  width: 160px;
}
.be-slug-input:focus {
  outline: none;
  border-color: var(--accent);
}
.be-status {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--muted);
}
.be-chip--dirty {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid var(--danger);
}
.be-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.be-tpl-select {
  font-family: inherit;
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--fg, #111);
}
.be-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  text-decoration: none;
}
.be-btn:hover:not(:disabled) {
  color: var(--fg, #111);
  border-color: var(--accent);
}
.be-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.be-btn--primary {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}
.be-btn--primary:hover:not(:disabled) {
  color: #fff;
  filter: brightness(0.95);
}
.be-btn--publish {
  color: #fff;
  background: var(--success, #16a34a);
  border-color: var(--success, #16a34a);
}
.be-btn--publish:hover:not(:disabled) {
  color: #fff;
  filter: brightness(0.95);
}
.be-btn--danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.be-revisions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.be-rev-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.be-rev-date,
.be-rev-empty {
  color: var(--text-tertiary);
}
.be-banner {
  padding: 8px 14px;
  font-size: 12.5px;
  color: var(--muted);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.be-banner--error {
  color: var(--danger);
  background: var(--danger-soft);
}
.be-loading {
  padding: 40px;
  text-align: center;
  color: var(--muted);
}
.be-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  overflow: hidden;
}
.be-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-2);
}
.be-preview-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.be-preview-bar .be-btn:first-of-type {
  margin-left: auto;
}
.be-iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: #fff;
}
.be-preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
</style>
