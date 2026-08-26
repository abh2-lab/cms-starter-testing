<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  mediaApi,
  uploadMedia,
  type ListMediaParams,
  type Media,
} from '@/api/media';

// Media picker — a big searchable grid modal. Keeps the SAME contract the rest
// of the app depends on (props: multiple/title; emits: close, select[items]),
// so MediaField, MediaKeyField and useMediaPicker keep working unchanged. On top
// of the old grid it adds: debounced server-side search, an All/Images filter,
// fast thumbnails (the 200px variant), drag-and-drop upload, and selection that
// survives search/filter changes (it tracks the chosen Media, not just ids).
const props = withDefaults(
  defineProps<{
    multiple?: boolean;
    title?: string;
  }>(),
  { multiple: false, title: 'Select media' },
);

const emit = defineEmits<{
  close: [];
  select: [items: Media[]];
}>();

const items = ref<Media[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const nextCursor = ref<string | null>(null);
const hasMore = ref(false);

const query = ref('');
const typeFilter = ref<'all' | 'image'>('all');
// Track the chosen Media (not just ids) so a multi-select survives a search or
// filter change that scrolls an item out of the current result set.
const chosen = ref<Map<string, Media>>(new Map());

const uploading = ref(false);
const uploadPct = ref(0);
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function baseParams(): ListMediaParams {
  const p: ListMediaParams = { limit: 40 };
  if (query.value.trim()) p.q = query.value.trim();
  if (typeFilter.value === 'image') p.type = 'image';
  return p;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await mediaApi.list(baseParams());
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
      ...baseParams(),
      cursor: nextCursor.value,
    });
    items.value.push(...res.data);
    nextCursor.value = res.pagination.nextCursor;
    hasMore.value = res.pagination.hasMore;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load more';
  } finally {
    loadingMore.value = false;
  }
}

// Debounce search + filter changes so typing doesn't fire a request per keystroke.
let debounce: ReturnType<typeof setTimeout> | undefined;
watch([query, typeFilter], () => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void load(), 250);
});

function toggle(m: Media): void {
  if (!props.multiple) {
    emit('select', [m]); // single-select → confirm on the first click
    return;
  }
  const next = new Map(chosen.value);
  if (next.has(m.id)) next.delete(m.id);
  else next.set(m.id, m);
  chosen.value = next;
}

function confirm(): void {
  emit('select', [...chosen.value.values()]);
}

function onPickFiles(): void {
  fileInput.value?.click();
}

async function uploadFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  uploading.value = true;
  uploadPct.value = 0;
  error.value = null;
  try {
    // Sequential so the single progress number stays meaningful.
    for (const file of files) {
      const media = await uploadMedia(file, (pct) => {
        uploadPct.value = pct;
      });
      items.value.unshift(media);
      if (!props.multiple) {
        emit('select', [media]);
        return;
      }
      const next = new Map(chosen.value);
      next.set(media.id, media);
      chosen.value = next;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Upload failed';
  } finally {
    uploading.value = false;
  }
}

async function onFilesChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  await uploadFiles(files);
}

async function onDrop(e: DragEvent): Promise<void> {
  dragOver.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []);
  await uploadFiles(files);
}

function isImage(m: Media): boolean {
  return m.mimeType.startsWith('image/');
}
function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : 'FILE';
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  void load();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <!-- Teleport to <body> so the picker always covers the real viewport. Some
       hosts (e.g. the draggable BlockStructureModal) carry a CSS `transform`,
       which would otherwise become the containing block for our
       `position: fixed` backdrop and shrink the modal to that panel's box. -->
  <Teleport to="body">
  <div class="mp-backdrop" @click.self="emit('close')">
    <div
      class="mp-modal"
      role="dialog"
      aria-modal="true"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <header class="mp-header">
        <h2 class="mp-title">{{ title }}</h2>
        <div class="mp-header-actions">
          <button
            type="button"
            class="btn btn-sm"
            :disabled="uploading"
            @click="onPickFiles"
          >
            {{ uploading ? `Uploading ${uploadPct}%` : '⬆ Upload' }}
          </button>
          <button
            type="button"
            class="mp-close"
            aria-label="Close"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
        <input
          ref="fileInput"
          type="file"
          :multiple="multiple"
          class="mp-hidden"
          @change="onFilesChosen"
        />
      </header>

      <div class="mp-toolbar">
        <div class="mp-search">
          <svg
            class="mp-search-icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              d="M21 21l-4.3-4.3M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
          <input
            v-model="query"
            type="search"
            class="mp-search-input"
            placeholder="Search by file name or alt text…"
            autofocus
          />
        </div>
        <div class="mp-filter" role="group" aria-label="Filter by type">
          <button
            type="button"
            :class="{ 'is-active': typeFilter === 'all' }"
            @click="typeFilter = 'all'"
          >
            All
          </button>
          <button
            type="button"
            :class="{ 'is-active': typeFilter === 'image' }"
            @click="typeFilter = 'image'"
          >
            Images
          </button>
        </div>
      </div>

      <div class="mp-body">
        <p v-if="loading" class="mp-muted">Loading…</p>
        <p v-else-if="error" class="mp-error">{{ error }}</p>
        <p v-else-if="items.length === 0" class="mp-muted">
          No media found. Try a different search, or drop files here / click
          <em>Upload</em> to add one.
        </p>

        <div v-else class="mp-grid">
          <button
            v-for="m in items"
            :key="m.id"
            type="button"
            class="mp-card"
            :class="{ 'is-selected': chosen.has(m.id) }"
            :title="m.originalFilename"
            @click="toggle(m)"
          >
            <div class="mp-thumb">
              <img
                v-if="isImage(m)"
                :src="m.thumbUrl || m.url"
                :alt="m.altText ?? m.originalFilename"
                loading="lazy"
              />
              <span v-else class="mp-ext">{{ fileExt(m.originalFilename) }}</span>
            </div>
            <span v-if="chosen.has(m.id)" class="mp-check">✓</span>
            <div class="mp-name">{{ m.originalFilename }}</div>
          </button>
        </div>

        <div v-if="hasMore && !loading" class="mp-loadmore">
          <button
            type="button"
            class="btn btn-sm"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? 'Loading…' : 'Load more' }}
          </button>
        </div>

        <div v-if="dragOver" class="mp-drop">Drop files to upload</div>
      </div>

      <footer class="mp-footer">
        <span class="mp-muted">
          {{
            multiple
              ? `${chosen.size} selected`
              : 'Click an image to select it'
          }}
        </span>
        <div class="mp-footer-actions">
          <button type="button" class="btn" @click="emit('close')">
            Cancel
          </button>
          <button
            v-if="multiple"
            type="button"
            class="btn btn-primary"
            :disabled="chosen.size === 0"
            @click="confirm"
          >
            Add selected
          </button>
        </div>
      </footer>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.mp-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Top modal tier (same as ConfirmDialog/LinkDialog). Must clear the
     draggable structure popup's z-index: 80 so the picker sits above it. */
  z-index: 1000;
  padding: 1rem;
}
.mp-modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  /* Large WordPress-style window: ~95% of the screen, centered, with a cap on
     very wide monitors so the thumbnail grid doesn't stretch absurdly. */
  width: min(1600px, 95vw);
  height: 95vh;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
}
.mp-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--fg);
}
.mp-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.mp-close {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0.25rem;
}
.mp-close:hover {
  color: var(--fg);
}
.mp-hidden {
  display: none;
}

.mp-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
}
.mp-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.mp-search:focus-within {
  border-color: var(--accent);
  box-shadow: var(--ring);
}
.mp-search-icon {
  color: var(--muted);
  flex: 0 0 auto;
}
.mp-search-input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--fg);
  font-size: 0.9375rem;
  font-family: inherit;
}
.mp-filter {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.mp-filter button {
  border: 0;
  background: var(--surface);
  color: var(--muted);
  padding: 0.45rem 0.85rem;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.mp-filter button + button {
  border-left: 1px solid var(--border);
}
.mp-filter button.is-active {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.mp-body {
  position: relative;
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
}
.mp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 0.85rem;
}
.mp-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  overflow: hidden;
  text-align: left;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.mp-card:hover {
  border-color: var(--accent);
}
.mp-card.is-selected {
  border-color: var(--accent);
  box-shadow: var(--ring);
}
.mp-thumb {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
  overflow: hidden;
}
.mp-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mp-ext {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.8125rem;
  color: var(--muted);
  font-weight: 600;
}
.mp-check {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-sm);
}
.mp-name {
  font-size: 0.6875rem;
  padding: 0.4rem 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
}
.mp-loadmore {
  display: flex;
  justify-content: center;
  padding-top: 1.25rem;
}
.mp-drop {
  position: absolute;
  inset: 0.5rem;
  border: 2px dashed var(--accent);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.mp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1.25rem;
  border-top: 1px solid var(--border);
}
.mp-footer-actions {
  display: flex;
  gap: 0.5rem;
}
.mp-muted {
  color: var(--muted);
  font-size: 0.875rem;
}
.mp-error {
  color: var(--danger);
  font-size: 0.875rem;
}
</style>
