<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { contentApi } from '@/api/content';
import type { ContentType } from '@/api/content-types';

// Drag-to-reorder + "Sort A→Z" for one content type (built for the team grid).
// Fetches the type's entries, lets the editor arrange them, and PUTs the new
// sort_order in one call. The public archive reads that order via ?sort=order.
// Hosted locally by ContentList, like ContentTypePickerModal.
const props = defineProps<{
  open: boolean;
  contentType: ContentType | null;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();

interface Row {
  id: string;
  title: string;
}

const rows = ref<Row[]>([]);
const loading = ref(false);
const saving = ref(false);
const resetting = ref(false);
const error = ref<string | null>(null);
const dirty = ref(false);

// Native-drag state — flat list, before/after only (no nesting).
const dragId = ref<string | null>(null);
const overId = ref<string | null>(null);
const overPos = ref<'before' | 'after'>('before');

async function load(): Promise<void> {
  const type = props.contentType;
  if (!type) return;
  loading.value = true;
  error.value = null;
  dirty.value = false;
  try {
    // One generous page — team lists are small. Sort client-side by the saved
    // sort_order (title tiebreak) so the modal opens on the current arrangement,
    // matching what the About page shows.
    const res = await contentApi.list({
      contentTypeId: type.id,
      limit: 100,
      page: 1,
    });
    rows.value = res.data
      .slice()
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
      )
      .map((c) => ({ id: c.id, title: c.title }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load entries';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void load();
  },
);

function onDragStart(id: string, e: DragEvent): void {
  dragId.value = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
}
function onDragOver(id: string, e: DragEvent): void {
  if (!dragId.value || dragId.value === id) return;
  // preventDefault is required for the element to be a valid drop target.
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
  overPos.value = ratio < 0.5 ? 'before' : 'after';
  overId.value = id;
}
function onDrop(targetId: string): void {
  const fromId = dragId.value;
  const pos = overPos.value;
  resetDrag();
  if (!fromId || fromId === targetId) return;
  const moved = rows.value.find((r) => r.id === fromId);
  if (!moved) return;
  // Remove first, THEN find the target index in the reduced array — avoids the
  // off-by-one you get when the dragged item sat above the target.
  const arr = rows.value.filter((r) => r.id !== fromId);
  const tIdx = arr.findIndex((r) => r.id === targetId);
  if (tIdx < 0) return;
  arr.splice(pos === 'before' ? tIdx : tIdx + 1, 0, moved);
  rows.value = arr;
  dirty.value = true;
}
function resetDrag(): void {
  dragId.value = null;
  overId.value = null;
}

function sortAlphabetical(): void {
  rows.value = rows.value
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title));
  dirty.value = true;
}

async function save(): Promise<void> {
  const type = props.contentType;
  if (!type || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    await contentApi.reorder(
      type.id,
      rows.value.map((r, i) => ({ id: r.id, sortOrder: i })),
    );
    emit('saved');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function resetOrder(): Promise<void> {
  const type = props.contentType;
  if (!type || resetting.value) return;
  if (
    !window.confirm(
      'Reset the order back to newest-first? Your custom arrangement will be cleared.',
    )
  ) {
    return;
  }
  resetting.value = true;
  error.value = null;
  try {
    await contentApi.resetOrder(type.id);
    emit('saved');
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Reset failed';
  } finally {
    resetting.value = false;
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (props.open && e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Transition name="cro">
    <div v-if="open" class="cro-backdrop" @click.self="emit('close')">
      <div
        class="cro-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="`Reorder ${contentType?.name ?? 'entries'}`"
      >
        <header class="cro-head">
          <div>
            <h2 class="cro-title">
              Reorder {{ contentType?.name ?? 'entries' }}
            </h2>
            <p class="cro-sub">
              Drag the handles to arrange, or sort A→Z. Save to apply.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-secondary cro-sort"
            :disabled="loading || rows.length < 2"
            @click="sortAlphabetical"
          >
            <Icon name="list-ordered" :size="14" /> Sort A→Z by name
          </button>
        </header>

        <p v-if="error" class="cro-error">{{ error }}</p>

        <div v-if="loading" class="cro-empty">Loading…</div>
        <div v-else-if="rows.length === 0" class="cro-empty">
          No entries to reorder.
        </div>
        <ul v-else class="cro-list">
          <li
            v-for="r in rows"
            :key="r.id"
            class="cro-item"
            :class="{
              'is-drag': dragId === r.id,
              'drop-before': overId === r.id && overPos === 'before',
              'drop-after': overId === r.id && overPos === 'after',
            }"
            draggable="true"
            @dragstart="onDragStart(r.id, $event)"
            @dragover="onDragOver(r.id, $event)"
            @drop="onDrop(r.id)"
            @dragend="resetDrag"
          >
            <span class="cro-handle" aria-hidden="true">
              <Icon name="align-justify" :size="16" />
            </span>
            <span class="cro-name">{{ r.title }}</span>
          </li>
        </ul>

        <footer class="cro-actions" style="justify-content: space-between">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="resetting || saving || loading || rows.length === 0"
            @click="resetOrder"
          >
            {{ resetting ? 'Resetting…' : 'Reset to newest' }}
          </button>
          <div style="display: flex; gap: 8px">
            <button
              type="button"
              class="btn btn-secondary"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="saving || !dirty"
              @click="save"
            >
              {{ saving ? 'Saving…' : 'Save order' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.cro-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.cro-dialog {
  width: 520px;
  max-width: 100%;
  max-height: min(82vh, 680px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 22px;
}
.cro-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.cro-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
}
.cro-sub {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.cro-sort {
  flex-shrink: 0;
  white-space: nowrap;
}
.cro-error {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--danger, #b91c1c);
}
.cro-empty {
  padding: 22px 4px;
  font-size: 13.5px;
  color: var(--muted);
  text-align: center;
}
.cro-list {
  list-style: none;
  margin: 0;
  padding: 2px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cro-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2, transparent);
  cursor: grab;
  /* A drop indicator draws as a coloured edge; keep the border transparent so
     it doesn't jump the layout when it turns on. */
  box-shadow: inset 0 0 0 0 var(--accent);
  transition: box-shadow 0.1s ease, opacity 0.1s ease;
}
.cro-item.is-drag {
  opacity: 0.4;
}
.cro-item.drop-before {
  box-shadow: inset 0 2px 0 0 var(--accent);
}
.cro-item.drop-after {
  box-shadow: inset 0 -2px 0 0 var(--accent);
}
.cro-handle {
  display: inline-flex;
  color: var(--muted);
  cursor: grab;
}
.cro-name {
  font-size: 14px;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cro-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* Transition — mirrors ContentTypePickerModal */
.cro-enter-from,
.cro-leave-to {
  opacity: 0;
}
.cro-enter-from .cro-dialog,
.cro-leave-to .cro-dialog {
  transform: translateY(8px) scale(0.98);
}
.cro-enter-active,
.cro-leave-active {
  transition: opacity 0.18s ease;
}
.cro-enter-active .cro-dialog,
.cro-leave-active .cro-dialog {
  transition: transform 0.18s ease;
}
</style>
