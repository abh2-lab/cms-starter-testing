<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, onMounted, ref, type Directive } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError } from '@/lib/api';
import {
  mediaApi,
  uploadMedia,
  type Media,
  type MediaDetail,
  type MediaContentUsageRef,
  type MediaPageUsageRef,
} from '@/api/media';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { confirm } = useConfirm();

// Sets the native `indeterminate` property (not bindable as an attribute) on a
// checkbox — used for the "select all" master checkbox's partial state.
const vIndeterminate: Directive<HTMLInputElement, boolean> = {
  mounted: (el, binding) => {
    el.indeterminate = binding.value;
  },
  updated: (el, binding) => {
    el.indeterminate = binding.value;
  },
};

interface UploadJob {
  id: string;
  name: string;
  pct: number;
  error: string | null;
}

const items = ref<Media[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const nextCursor = ref<string | null>(null);
const hasMore = ref(false);
const filterType = ref<string>('');
const search = ref('');
const view = ref<'grid' | 'list'>('grid');
const dragOver = ref(false);

// Multi-select for bulk actions.
const selectedIds = ref<Set<string>>(new Set());
const bulkDeleting = ref(false);

const uploads = ref<UploadJob[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

// Detail drawer state.
const selected = ref<MediaDetail | null>(null);
const editAlt = ref('');
const editCaption = ref('');
const savingMeta = ref(false);
// Reverse-lookup of where this media is referenced. Lazy-loaded when the
// drawer opens so the list view stays cheap.
const usageContent = ref<MediaContentUsageRef[]>([]);
const usagePages = ref<MediaPageUsageRef[]>([]);
const usageLoading = ref(false);
const usageError = ref<string | null>(null);

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'application', label: 'Documents' },
];

// Client-side filename search over the loaded items (type is server-filtered).
const visibleItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((m) =>
    m.originalFilename.toLowerCase().includes(q),
  );
});

const selectedCount = computed(() => selectedIds.value.size);
const allVisibleSelected = computed(
  () =>
    visibleItems.value.length > 0 &&
    visibleItems.value.every((m) => selectedIds.value.has(m.id)),
);
const someVisibleSelected = computed(
  () =>
    !allVisibleSelected.value &&
    visibleItems.value.some((m) => selectedIds.value.has(m.id)),
);

function toggleSelect(id: string): void {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}
function toggleSelectAll(): void {
  const next = new Set(selectedIds.value);
  if (allVisibleSelected.value) {
    for (const m of visibleItems.value) next.delete(m.id);
  } else {
    for (const m of visibleItems.value) next.add(m.id);
  }
  selectedIds.value = next;
}
function clearSelection(): void {
  selectedIds.value = new Set();
}

function listParams() {
  return {
    limit: 40,
    ...(filterType.value ? { type: filterType.value } : {}),
  };
}

async function loadFirst(): Promise<void> {
  loading.value = true;
  error.value = null;
  items.value = [];
  selectedIds.value = new Set();
  nextCursor.value = null;
  hasMore.value = false;
  try {
    const res = await mediaApi.list(listParams());
    items.value = res.data;
    nextCursor.value = res.pagination.nextCursor;
    hasMore.value = res.pagination.hasMore;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load media';
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const res = await mediaApi.list({
      ...listParams(),
      cursor: nextCursor.value,
    });
    items.value.push(...res.data);
    nextCursor.value = res.pagination.nextCursor;
    hasMore.value = res.pagination.hasMore;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to load more');
  } finally {
    loadingMore.value = false;
  }
}

function onPickFiles(): void {
  fileInput.value?.click();
}

async function onFilesChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ''; // allow re-selecting the same file
  await Promise.all(files.map((f) => runUpload(f)));
}

async function onDrop(e: DragEvent): Promise<void> {
  dragOver.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) await Promise.all(files.map((f) => runUpload(f)));
}

async function runUpload(file: File): Promise<void> {
  const job: UploadJob = {
    id: crypto.randomUUID(),
    name: file.name,
    pct: 0,
    error: null,
  };
  uploads.value.unshift(job);
  try {
    const media = await uploadMedia(file, (pct) => {
      job.pct = pct;
    });
    items.value.unshift(media);
    uploads.value = uploads.value.filter((u) => u.id !== job.id);
  } catch (e) {
    job.error = e instanceof Error ? e.message : 'Upload failed';
  }
}

function dismissUpload(id: string): void {
  uploads.value = uploads.value.filter((u) => u.id !== id);
}

async function openDetail(id: string): Promise<void> {
  try {
    const { data } = await mediaApi.get(id);
    selected.value = data;
    editAlt.value = data.altText ?? '';
    editCaption.value = data.caption ?? '';
    void loadUsage(id);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to open media');
  }
}

async function loadUsage(id: string): Promise<void> {
  usageContent.value = [];
  usagePages.value = [];
  usageError.value = null;
  usageLoading.value = true;
  try {
    const { data } = await mediaApi.usage(id);
    usageContent.value = data.contentRefs;
    usagePages.value = data.pageRefs;
  } catch (e) {
    usageError.value = e instanceof Error ? e.message : 'Failed to load usage';
  } finally {
    usageLoading.value = false;
  }
}

function closeDetail(): void {
  selected.value = null;
  usageContent.value = [];
  usagePages.value = [];
  usageError.value = null;
}

async function saveMeta(): Promise<void> {
  if (!selected.value) return;
  savingMeta.value = true;
  try {
    const { data } = await mediaApi.update(selected.value.id, {
      altText: editAlt.value || null,
      caption: editCaption.value || null,
    });
    const idx = items.value.findIndex((m) => m.id === data.id);
    const existing = idx === -1 ? undefined : items.value[idx];
    if (existing) items.value[idx] = { ...existing, ...data };
    selected.value = { ...selected.value, ...data };
    toast.success('Details saved');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Save failed');
  } finally {
    savingMeta.value = false;
  }
}

async function deleteMedia(m: {
  id: string;
  originalFilename: string;
}): Promise<void> {
  const ok = await confirm({
    title: 'Delete media',
    message: `Delete "${m.originalFilename}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await mediaApi.remove(m.id);
    items.value = items.value.filter((x) => x.id !== m.id);
    selectedIds.value.delete(m.id);
    if (selected.value?.id === m.id) selected.value = null;
    toast.success('Media deleted');
  } catch (e) {
    toast.error(
      `Delete failed: ${e instanceof ApiError ? e.message : 'unknown error'}`,
    );
  }
}

async function bulkDelete(): Promise<void> {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  const ok = await confirm({
    title: 'Delete files',
    message: `Delete ${ids.length} selected file${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
    confirmLabel: `Delete ${ids.length}`,
    tone: 'danger',
  });
  if (!ok) return;
  bulkDeleting.value = true;
  const results = await Promise.allSettled(
    ids.map((id) => mediaApi.remove(id)),
  );
  const deleted = new Set<string>();
  let failed = 0;
  results.forEach((r, i) => {
    const id = ids[i];
    if (!id) return;
    if (r.status === 'fulfilled') deleted.add(id);
    else failed++;
  });
  items.value = items.value.filter((m) => !deleted.has(m.id));
  const next = new Set(selectedIds.value);
  for (const id of deleted) next.delete(id);
  selectedIds.value = next;
  if (selected.value && deleted.has(selected.value.id)) selected.value = null;
  bulkDeleting.value = false;

  if (failed === 0) {
    toast.success(`Deleted ${deleted.size} file${deleted.size === 1 ? '' : 's'}`);
  } else if (deleted.size === 0) {
    toast.error(`Delete failed for all ${failed} file${failed === 1 ? '' : 's'}`);
  } else {
    toast.warning(`Deleted ${deleted.size}, ${failed} failed`);
  }
}

function isImage(m: { mimeType: string }): boolean {
  return m.mimeType.startsWith('image/');
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : 'FILE';
}

function typeLabel(mime: string): string {
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime === 'application/pdf') return 'PDF';
  return 'Document';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaMeta(m: Media): string {
  if (isImage(m) && m.width && m.height) {
    return `${m.width}×${m.height} · ${formatBytes(m.fileSizeBytes)}`;
  }
  return `${typeLabel(m.mimeType)} · ${formatBytes(m.fileSizeBytes)}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

onMounted(loadFirst);
</script>

<template>
  <section class="media-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">Media Library</h1>
        <p class="page-subtitle">
          Upload and manage images, video, and documents.
        </p>
      </div>
      <button type="button" class="btn btn-primary" @click="onPickFiles">
        <Icon name="upload-cloud" :size="14" />
        Upload Files
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="hidden-input"
        @change="onFilesChosen"
      />
    </header>

    <!-- Drag & drop zone -->
    <div
      class="upload-zone"
      :class="{ dragover: dragOver }"
      role="button"
      tabindex="0"
      @click="onPickFiles"
      @keydown.enter="onPickFiles"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <Icon name="upload-cloud" :size="30" />
      <div class="upload-title">Drag &amp; drop files here</div>
      <div class="upload-sub">
        or click to browse · JPG, PNG, WebP, GIF, MP4, PDF
      </div>
    </div>

    <!-- Active uploads -->
    <ul v-if="uploads.length" class="uploads card">
      <li v-for="u in uploads" :key="u.id" class="upload-row">
        <span class="upload-name">{{ u.name }}</span>
        <template v-if="u.error">
          <span class="upload-error">{{ u.error }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            @click="dismissUpload(u.id)"
          >
            Dismiss
          </button>
        </template>
        <template v-else>
          <span class="progress">
            <span class="progress-bar" :style="{ width: `${u.pct}%` }" />
          </span>
          <span class="upload-pct">{{ u.pct }}%</span>
        </template>
      </li>
    </ul>

    <!-- Toolbar -->
    <div class="table-wrap toolbar-only">
      <div class="table-toolbar">
        <div class="filter-bar">
          <div class="search-input">
            <Icon name="search" :size="13" />
            <input v-model="search" type="text" placeholder="Search files…" />
          </div>
          <select
            v-model="filterType"
            class="select-filter"
            @change="loadFirst"
          >
            <option v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </div>
        <div class="view-toggle">
          <button
            type="button"
            class="btn btn-sm"
            :class="view === 'grid' ? 'btn-secondary' : 'btn-ghost'"
            @click="view = 'grid'"
          >
            <Icon name="grid" :size="13" /> Grid
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :class="view === 'list' ? 'btn-secondary' : 'btn-ghost'"
            @click="view = 'list'"
          >
            <Icon name="list" :size="13" /> List
          </button>
        </div>
      </div>
    </div>

    <!-- Selection bar (select-all + bulk actions) -->
    <div
      v-if="!loading && !error && visibleItems.length > 0"
      class="selection-bar"
      :class="{ active: selectedCount > 0 }"
    >
      <label class="sel-all">
        <input
          v-indeterminate="someVisibleSelected"
          type="checkbox"
          :checked="allVisibleSelected"
          @change="toggleSelectAll"
        />
        <span>{{
          selectedCount > 0 ? `${selectedCount} selected` : 'Select all'
        }}</span>
      </label>
      <div v-if="selectedCount > 0" class="sel-actions">
        <button type="button" class="btn btn-ghost btn-sm" @click="clearSelection">
          Clear
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          :disabled="bulkDeleting"
          @click="bulkDelete"
        >
          <Icon name="trash" :size="13" />
          {{ bulkDeleting ? 'Deleting…' : `Delete (${selectedCount})` }}
        </button>
      </div>
    </div>

    <!-- States -->
    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg error">{{ error }}</p>
    <div v-else-if="visibleItems.length === 0" class="empty-state card">
      <div class="empty-title">
        {{ search || filterType ? 'No matching files' : 'No media yet' }}
      </div>
      <p class="state-msg">
        {{
          search || filterType
            ? 'Try a different search or filter.'
            : 'Drag files onto the box above or click Upload Files.'
        }}
      </p>
    </div>

    <!-- Grid view -->
    <div v-else-if="view === 'grid'" class="media-grid">
      <div
        v-for="m in visibleItems"
        :key="m.id"
        class="media-card"
        :class="{ 'is-selected': selectedIds.has(m.id) }"
        role="button"
        tabindex="0"
        @click="openDetail(m.id)"
        @keydown.enter="openDetail(m.id)"
      >
        <label class="media-check" @click.stop>
          <input
            type="checkbox"
            :checked="selectedIds.has(m.id)"
            @change="toggleSelect(m.id)"
          />
        </label>
        <div class="media-thumb">
          <img
            v-if="isImage(m)"
            :src="m.url"
            :alt="m.altText ?? m.originalFilename"
            loading="lazy"
          />
          <span v-else class="thumb-ext">{{ fileExt(m.originalFilename) }}</span>
        </div>
        <div class="media-info">
          <div class="media-name">{{ m.originalFilename }}</div>
          <div class="media-meta">{{ mediaMeta(m) }}</div>
        </div>
      </div>
    </div>

    <!-- List view -->
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th class="cb-col">
              <input
                v-indeterminate="someVisibleSelected"
                type="checkbox"
                :checked="allVisibleSelected"
                @change="toggleSelectAll"
              />
            </th>
            <th>File</th>
            <th>Type</th>
            <th>Size</th>
            <th>Dimensions</th>
            <th>Uploaded</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in visibleItems"
            :key="m.id"
            class="list-row"
            :class="{ 'is-selected': selectedIds.has(m.id) }"
            @click="openDetail(m.id)"
          >
            <td class="cb-col" @click.stop>
              <input
                type="checkbox"
                :checked="selectedIds.has(m.id)"
                @change="toggleSelect(m.id)"
              />
            </td>
            <td>
              <div class="list-file">
                <span class="list-thumb">
                  <img
                    v-if="isImage(m)"
                    :src="m.url"
                    :alt="m.originalFilename"
                    loading="lazy"
                  />
                  <span v-else>{{ fileExt(m.originalFilename) }}</span>
                </span>
                <span class="list-name">{{ m.originalFilename }}</span>
              </div>
            </td>
            <td>{{ typeLabel(m.mimeType) }}</td>
            <td>{{ formatBytes(m.fileSizeBytes) }}</td>
            <td>{{ m.width && m.height ? `${m.width}×${m.height}` : '—' }}</td>
            <td>{{ shortDate(m.createdAt) }}</td>
            <td>
              <div class="actions">
                <button
                  type="button"
                  class="icon-btn icon-btn--danger"
                  title="Delete"
                  @click.stop="deleteMedia(m)"
                >
                  <Icon name="trash" :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="hasMore && !loading" class="load-more">
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? 'Loading…' : 'Load more' }}
      </button>
    </div>

    <!-- Detail drawer -->
    <Transition name="drawer">
      <div v-if="selected" class="drawer-backdrop" @click.self="closeDetail">
        <aside class="drawer">
          <header class="drawer-header">
            <h2>Details</h2>
            <button
              type="button"
              class="icon-btn"
              aria-label="Close"
              @click="closeDetail"
            >
              <Icon name="x" :size="15" />
            </button>
          </header>

          <div class="preview">
            <img
              v-if="isImage(selected)"
              :src="selected.url"
              :alt="selected.altText ?? selected.originalFilename"
            />
            <span v-else class="thumb-ext thumb-ext--lg">{{
              fileExt(selected.originalFilename)
            }}</span>
          </div>

          <dl class="facts">
            <div><dt>File</dt><dd>{{ selected.originalFilename }}</dd></div>
            <div><dt>Type</dt><dd>{{ selected.mimeType }}</dd></div>
            <div>
              <dt>Size</dt>
              <dd>{{ formatBytes(selected.fileSizeBytes) }}</dd>
            </div>
            <div v-if="selected.width">
              <dt>Dimensions</dt>
              <dd>{{ selected.width }} × {{ selected.height }}</dd>
            </div>
            <div><dt>Uploaded</dt><dd>{{ shortDate(selected.createdAt) }}</dd></div>
            <div><dt>Key</dt><dd class="mono">{{ selected.storageKey }}</dd></div>
          </dl>

          <section class="usage-section" aria-label="Usage">
            <h3 class="usage-title">Used in</h3>
            <div v-if="usageLoading" class="usage-empty muted">Loading…</div>
            <div v-else-if="usageError" class="usage-empty">
              <span class="muted">Couldn't load usage:</span> {{ usageError }}
            </div>
            <template v-else>
              <ul
                v-if="usageContent.length || usagePages.length"
                class="usage-list"
              >
                <li v-for="c in usageContent" :key="`c-${c.id}`">
                  <RouterLink
                    :to="{ name: 'content-edit', params: { id: c.id } }"
                    class="usage-link"
                  >
                    <span class="usage-kind">{{ c.typeName ?? 'Content' }}</span>
                    <span class="usage-name">{{ c.title || '(untitled)' }}</span>
                    <span class="usage-status">{{ c.status }}</span>
                  </RouterLink>
                </li>
                <li v-for="p in usagePages" :key="`p-${p.id}`">
                  <!-- The usage payload doesn't carry page.type, so we
                       always link to the static editor route — if the row
                       turns out to be dynamic, usePageEditorShell redirects
                       to /pages/:id/build on load. -->
                  <RouterLink
                    :to="{ name: 'page-edit-static', params: { id: p.id } }"
                    class="usage-link"
                  >
                    <span class="usage-kind">Page</span>
                    <span class="usage-name">{{ p.title || p.slug }}</span>
                    <span class="usage-status">{{ p.status }}</span>
                  </RouterLink>
                </li>
              </ul>
              <p v-else class="usage-empty muted">
                Not used anywhere yet.
              </p>
            </template>
            <p class="muted small usage-caveat">
              Shows usage in media fields and dynamic page blocks. Inline body images aren't tracked.
            </p>
          </section>

          <div class="form-group">
            <label class="form-label">Alt text</label>
            <input v-model="editAlt" type="text" maxlength="1000" class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label">Caption</label>
            <textarea
              v-model="editCaption"
              rows="3"
              maxlength="2000"
              class="form-textarea"
            />
          </div>

          <div class="drawer-actions">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="savingMeta"
              @click="saveMeta"
            >
              {{ savingMeta ? 'Saving…' : 'Save changes' }}
            </button>
            <button
              type="button"
              class="btn btn-danger"
              @click="deleteMedia(selected)"
            >
              <Icon name="trash" :size="14" /> Delete
            </button>
          </div>
        </aside>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.media-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.hidden-input {
  display: none;
}
.state-msg {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}
.state-msg.error {
  color: var(--danger);
}

/* ── Upload drop zone ── */
.upload-zone {
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
  background: var(--surface);
  color: var(--text-tertiary);
}
.upload-zone:hover {
  border-color: var(--muted);
  background: var(--bg);
}
.upload-zone.dragover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
}
.upload-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--muted);
  margin-top: 6px;
}
.upload-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
}

/* ── Active uploads ── */
.uploads {
  list-style: none;
  margin: 0;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.upload-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
}
.upload-name {
  flex: 0 0 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
}
.progress {
  flex: 1;
  height: 6px;
  background: var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.progress-bar {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.15s;
}
.upload-pct {
  width: 3rem;
  text-align: right;
  color: var(--muted);
}
.upload-error {
  flex: 1;
  color: var(--danger);
}

/* ── Toolbar (toolbar-only table-wrap has no table under it) ── */
.toolbar-only .table-toolbar {
  border-bottom: none;
}
.view-toggle {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

/* ── Selection bar ── */
.selection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.selection-bar.active {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.sel-all {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
  cursor: pointer;
}
.sel-all input,
.cb-col input,
.media-check input {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--accent);
}
.sel-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

/* ── Media grid (from dashboard mockup) ── */
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.media-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  background: var(--surface);
  padding: 0;
  text-align: left;
  font-family: inherit;
}
.media-card:hover {
  border-color: var(--text-tertiary);
  box-shadow: var(--shadow-sm);
}
.media-card.is-selected {
  border-color: var(--accent);
  box-shadow: var(--ring);
}
.media-check {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  display: flex;
  padding: 3px;
  border-radius: 5px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  opacity: 0;
  transition: opacity 0.15s;
}
.media-card:hover .media-check,
.media-card.is-selected .media-check {
  opacity: 1;
}
.media-check input {
  display: block;
}
.media-thumb {
  aspect-ratio: 4 / 3;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}
.media-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-ext {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
}
.thumb-ext--lg {
  font-size: 2rem;
}
.media-info {
  padding: 8px 10px;
}
.media-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* ── List view ── */
.cb-col {
  width: 36px;
  text-align: center;
}
.list-row {
  cursor: pointer;
}
.list-row.is-selected td {
  background: var(--accent-soft);
}
.list-file {
  display: flex;
  align-items: center;
  gap: 10px;
}
.list-thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary);
}
.list-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.list-name {
  font-weight: 500;
}

.load-more {
  text-align: center;
  margin-top: 4px;
}

/* ── Detail drawer ── */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: flex-end;
  z-index: 60;
}
.drawer {
  width: 26rem;
  max-width: 92vw;
  background: var(--surface);
  height: 100%;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.drawer-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.preview {
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.facts {
  margin: 0;
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.facts > div {
  display: flex;
  gap: 10px;
}
.facts dt {
  color: var(--muted);
  width: 6rem;
  flex-shrink: 0;
}
.facts dd {
  margin: 0;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
}
.form-group {
  margin: 0;
}

/* Usage section in detail drawer */
.usage-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}
.usage-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.usage-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.usage-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  text-decoration: none;
  color: var(--fg);
  font-size: 13px;
  transition: background 0.15s, border-color 0.15s;
}
.usage-link:hover {
  background: var(--bg);
  border-color: var(--accent);
}
.usage-kind {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  flex-shrink: 0;
}
.usage-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-status {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  flex-shrink: 0;
}
.usage-empty {
  font-size: 13px;
}
.usage-caveat {
  margin-top: 2px;
}

.drawer-actions {
  display: flex;
  gap: 10px;
  margin-top: auto;
  padding-top: 8px;
}

/* Drawer transition */
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(100%);
}
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform 0.2s ease;
}
</style>
