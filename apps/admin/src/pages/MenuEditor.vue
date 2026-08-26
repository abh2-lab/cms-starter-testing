<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  RouterLink,
  useRoute,
  useRouter,
  onBeforeRouteLeave,
} from 'vue-router';
import {
  menusApi,
  type Menu,
  type MenuItem,
  type ReorderItem,
} from '@/api/menus';
import { contentApi, type Content } from '@/api/content';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const route = useRoute();
const router = useRouter();
const menuId = computed(() => route.params['id'] as string);

const menu = ref<Menu | null>(null);
const allMenus = ref<Menu[]>([]);
const items = ref<MenuItem[]>([]);
const contentOptions = ref<Content[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const dirty = ref(false); // unsaved drag (reorder/nest) changes
const saving = ref(false);

// Unified add/edit form (the right card edits the item it was opened on).
const fTab = ref<'url' | 'content'>('url');
const fLabel = ref('');
const fUrl = ref('');
const fContentId = ref('');
const fParentId = ref('');
const fNewTab = ref(false);
const editingId = ref<string | null>(null);
const submitting = ref(false);
const labelInput = ref<HTMLInputElement | null>(null);

const sortFn = (a: MenuItem, b: MenuItem): number =>
  a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);

const topLevel = computed(() =>
  items.value.filter((i) => i.parentId === null).sort(sortFn),
);

const ordered = computed<{ item: MenuItem; depth: number }[]>(() => {
  const out: { item: MenuItem; depth: number }[] = [];
  for (const top of topLevel.value) {
    out.push({ item: top, depth: 0 });
    for (const c of items.value
      .filter((i) => i.parentId === top.id)
      .sort(sortFn)) {
      out.push({ item: c, depth: 1 });
    }
  }
  return out;
});

function contentTitle(id: string | null): string | null {
  if (!id) return null;
  return (
    contentOptions.value.find((c) => c.id === id)?.title ?? '(linked content)'
  );
}
function itemDest(item: MenuItem): string {
  return contentTitle(item.contentId) ?? item.url ?? '—';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [menuRes, listRes, contentRes] = await Promise.all([
      menusApi.get(menuId.value),
      menusApi.list(),
      contentApi.list({ limit: 100 }),
    ]);
    menu.value = menuRes.data;
    items.value = menuRes.data.items;
    allMenus.value = listRes.data;
    contentOptions.value = contentRes.data;
    dirty.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

const { confirm } = useConfirm();

watch(menuId, () => {
  resetForm();
  void load();
});

async function onSwitchMenu(e: Event): Promise<void> {
  const target = e.target as HTMLSelectElement;
  const id = target.value;
  if (!id || id === menuId.value) return;
  if (dirty.value) {
    const ok = await confirm({
      title: 'Discard changes?',
      message: 'Discard unsaved arrangement changes?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
    if (!ok) {
      target.value = menuId.value;
      return;
    }
  }
  void router.push({ name: 'menu-edit', params: { id } });
}

onBeforeRouteLeave(async () => {
  if (dirty.value) {
    return await confirm({
      title: 'Unsaved changes',
      message: 'You have unsaved menu arrangement changes. Leave without saving?',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
    });
  }
  return true;
});

// ── Add / edit form (saves immediately) ──
function resetForm(): void {
  editingId.value = null;
  fTab.value = 'url';
  fLabel.value = '';
  fUrl.value = '';
  fContentId.value = '';
  fParentId.value = '';
  fNewTab.value = false;
}
function focusAdd(): void {
  resetForm();
  void nextTick(() => labelInput.value?.focus());
}
function startEdit(item: MenuItem): void {
  editingId.value = item.id;
  fTab.value = item.contentId ? 'content' : 'url';
  fLabel.value = item.label;
  fUrl.value = item.url ?? '';
  fContentId.value = item.contentId ?? '';
  fParentId.value = item.parentId ?? '';
  fNewTab.value = item.openInNewTab;
  void nextTick(() => labelInput.value?.focus());
}
async function onSubmit(): Promise<void> {
  if (!fLabel.value.trim()) return;
  submitting.value = true;
  error.value = null;
  const body = {
    label: fLabel.value,
    url: fTab.value === 'url' ? fUrl.value || null : null,
    contentId: fTab.value === 'content' ? fContentId.value || null : null,
    parentId: fParentId.value || null,
    openInNewTab: fNewTab.value,
  };
  try {
    if (editingId.value) {
      const res = await menusApi.updateItem(menuId.value, editingId.value, body);
      const idx = items.value.findIndex((x) => x.id === editingId.value);
      if (idx !== -1) items.value[idx] = res.data;
    } else {
      const sibs = items.value.filter((i) => i.parentId === body.parentId);
      const res = await menusApi.createItem(menuId.value, {
        ...body,
        sortOrder: sibs.length,
      });
      items.value.push(res.data);
    }
    resetForm();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Save failed';
  } finally {
    submitting.value = false;
  }
}

async function onDelete(item: MenuItem): Promise<void> {
  const childCount = items.value.filter((x) => x.parentId === item.id).length;
  const extra =
    childCount > 0
      ? ` Its ${childCount} child item(s) will also be removed.`
      : '';
  const ok = await confirm({
    title: 'Delete menu item',
    message: `Delete "${item.label}"?${extra}`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await menusApi.removeItem(menuId.value, item.id);
    items.value = items.value.filter(
      (x) => x.id !== item.id && x.parentId !== item.id,
    );
    if (editingId.value === item.id) resetForm();
    toast.success('Menu item deleted');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

// ── Drag to reorder + nest (local draft → "Save Menu" persists) ──
const dragId = ref<string | null>(null);
const dropTargetId = ref<string | null>(null);
const dropMode = ref<'before' | 'after' | 'nest'>('before');

function draggedHasChildren(): boolean {
  return (
    dragId.value !== null && items.value.some((i) => i.parentId === dragId.value)
  );
}
function onDragStart(item: MenuItem, e: DragEvent): void {
  dragId.value = item.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  }
}
function onDragOver(item: MenuItem, e: DragEvent): void {
  if (!dragId.value || dragId.value === item.id) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
  // Nest only INTO a top-level item, and only if the dragged item isn't itself
  // a parent (keeps the tree at two levels).
  if (
    item.parentId === null &&
    !draggedHasChildren() &&
    ratio > 0.34 &&
    ratio < 0.66
  ) {
    dropMode.value = 'nest';
  } else {
    dropMode.value = ratio < 0.5 ? 'before' : 'after';
  }
  dropTargetId.value = item.id;
}
function onDrop(target: MenuItem): void {
  const fromId = dragId.value;
  const mode = dropMode.value;
  resetDrag();
  if (!fromId || fromId === target.id) return;
  const dragged = items.value.find((i) => i.id === fromId);
  if (!dragged) return;

  const newParent = mode === 'nest' ? target.id : target.parentId;
  if (newParent === fromId) return; // can't parent to self
  if (newParent !== null && draggedHasChildren()) return; // don't nest a parent

  const sibs = items.value
    .filter((i) => i.parentId === newParent && i.id !== fromId)
    .sort(sortFn);
  let insertIdx: number;
  if (mode === 'nest') {
    insertIdx = sibs.length;
  } else {
    const tIdx = sibs.findIndex((s) => s.id === target.id);
    insertIdx = tIdx < 0 ? sibs.length : mode === 'before' ? tIdx : tIdx + 1;
  }
  dragged.parentId = newParent;
  sibs.splice(insertIdx, 0, dragged);
  sibs.forEach((s, k) => {
    s.sortOrder = k;
  });
  dirty.value = true;
}
function resetDrag(): void {
  dragId.value = null;
  dropTargetId.value = null;
}

async function onSaveOrder(): Promise<void> {
  if (!dirty.value || saving.value) return;
  saving.value = true;
  error.value = null;
  const payload: ReorderItem[] = items.value.map((i) => ({
    id: i.id,
    sortOrder: i.sortOrder,
    parentId: i.parentId,
  }));
  try {
    await menusApi.reorderItems(menuId.value, payload);
    dirty.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Menus</h1>
        <p class="page-subtitle">Build and reorder navigation items</p>
      </div>
      <RouterLink :to="{ name: 'menus' }" class="btn btn-secondary btn-sm">
        All menus
      </RouterLink>
    </header>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="!menu" class="state-msg error">{{ error ?? 'Not found' }}</p>

    <template v-else>
      <p v-if="error" class="state-msg error">{{ error }}</p>

      <div class="menu-grid">
        <!-- Left: selector + items -->
        <div class="menu-left">
          <div class="card">
            <div class="card-title tight">Select Menu</div>
            <select class="form-select" :value="menuId" @change="onSwitchMenu">
              <option v-for="m in allMenus" :key="m.id" :value="m.id">
                {{ m.name }}
              </option>
            </select>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title">{{ menu.name }}</div>
              <button type="button" class="btn btn-secondary btn-sm" @click="focusAdd">
                + Add Item
              </button>
            </div>
            <div class="drag-hint">
              Drag the handle to reorder. Drop onto an item to make it a
              sub-item.
            </div>

            <p v-if="ordered.length === 0" class="state-msg">
              No items yet — add one with the form.
            </p>
            <div
              v-for="{ item, depth } in ordered"
              :key="item.id"
              class="menu-item-row"
              :class="{
                'menu-child': depth > 0,
                dragging: dragId === item.id,
                'drop-before': dropTargetId === item.id && dropMode === 'before',
                'drop-after': dropTargetId === item.id && dropMode === 'after',
                'drop-nest': dropTargetId === item.id && dropMode === 'nest',
              }"
              draggable="true"
              @dragstart="onDragStart(item, $event)"
              @dragend="resetDrag"
              @dragover.prevent="onDragOver(item, $event)"
              @drop.prevent="onDrop(item)"
            >
              <span class="drag-handle" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="9" cy="6" r="1.5" />
                  <circle cx="15" cy="6" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" />
                  <circle cx="9" cy="18" r="1.5" />
                  <circle cx="15" cy="18" r="1.5" />
                </svg>
              </span>
              <div class="menu-item-main">
                <div class="menu-item-title">{{ item.label }}</div>
                <div class="menu-item-url mono">{{ itemDest(item) }}</div>
              </div>
              <button
                type="button"
                class="icon-btn"
                :class="{ active: editingId === item.id }"
                title="Edit"
                aria-label="Edit"
                @click="startEdit(item)"
              >
                <Icon name="edit" />
              </button>
              <button
                type="button"
                class="icon-btn icon-btn--danger"
                title="Delete"
                aria-label="Delete"
                @click="onDelete(item)"
              >
                <Icon name="trash" />
              </button>
            </div>

            <button
              v-if="ordered.length"
              type="button"
              class="btn save-menu"
              :class="dirty ? 'btn-primary' : 'btn-secondary'"
              :disabled="!dirty || saving"
              @click="onSaveOrder"
            >
              {{ saving ? 'Saving…' : dirty ? 'Save Menu' : 'All changes saved' }}
            </button>
          </div>
        </div>

        <!-- Right: add / edit form -->
        <div class="menu-right">
          <div class="card">
            <div class="card-title tight-lg">
              {{ editingId ? 'Edit Menu Item' : 'Add Menu Item' }}
            </div>

            <div class="tab-bar">
              <button
                type="button"
                class="tab-btn"
                :class="{ active: fTab === 'url' }"
                @click="fTab = 'url'"
              >
                Custom URL
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: fTab === 'content' }"
                @click="fTab = 'content'"
              >
                Content Link
              </button>
            </div>

            <form @submit.prevent="onSubmit">
              <div class="form-group">
                <label class="form-label">Label</label>
                <input
                  ref="labelInput"
                  v-model="fLabel"
                  class="form-input"
                  placeholder="e.g. About Us"
                  maxlength="200"
                />
              </div>

              <div v-if="fTab === 'url'" class="form-group">
                <label class="form-label">URL</label>
                <input
                  v-model="fUrl"
                  class="form-input mono"
                  placeholder="/about-us or https://…"
                />
              </div>
              <div v-else class="form-group">
                <label class="form-label">Content</label>
                <select v-model="fContentId" class="form-select">
                  <option value="">— select content —</option>
                  <option v-for="c in contentOptions" :key="c.id" :value="c.id">
                    {{ c.title }}
                  </option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Parent Item (optional)</label>
                <select v-model="fParentId" class="form-select">
                  <option value="">— Top level —</option>
                  <option
                    v-for="t in topLevel"
                    :key="t.id"
                    :value="t.id"
                    :disabled="editingId === t.id"
                  >
                    {{ t.label }}
                  </option>
                </select>
                <div class="form-hint">Or drag an item onto a parent to nest it.</div>
              </div>

              <div class="form-group">
                <label class="form-label">Open In</label>
                <select v-model="fNewTab" class="form-select">
                  <option :value="false">Same tab</option>
                  <option :value="true">New tab</option>
                </select>
              </div>

              <div class="form-actions">
                <button
                  type="submit"
                  class="btn btn-primary"
                  :disabled="submitting || !fLabel.trim()"
                >
                  {{
                    submitting
                      ? 'Saving…'
                      : editingId
                        ? 'Save Changes'
                        : 'Add to Menu'
                  }}
                </button>
                <button
                  v-if="editingId"
                  type="button"
                  class="btn btn-ghost"
                  @click="resetForm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.state-msg {
  color: var(--muted);
  font-size: 0.9rem;
  padding: 8px 0;
}
.state-msg.error {
  color: var(--danger);
}
.tight {
  margin-bottom: 12px;
}
.tight-lg {
  margin-bottom: 16px;
}

.menu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}
@media (max-width: 900px) {
  .menu-grid {
    grid-template-columns: 1fr;
  }
}
.menu-left {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.drag-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}

.menu-item-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--border-soft);
  cursor: move;
}
.menu-item-row:active {
  cursor: grabbing;
}
.menu-item-row:last-of-type {
  border-bottom: none;
}
.menu-child {
  margin-left: 24px;
}
.menu-item-main {
  flex: 1;
  min-width: 0;
}
.menu-item-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--fg);
}
.menu-child .menu-item-title {
  font-size: 12.5px;
}
.menu-item-url {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.menu-item-row.dragging {
  opacity: 0.4;
}
/* Drop indicator: highlight the whole row border. Nest stays distinct via its
   tinted fill. */
.menu-item-row.drop-before,
.menu-item-row.drop-after {
  box-shadow: inset 0 0 0 2px var(--accent);
}
.menu-item-row.drop-nest {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 2px var(--accent);
}
.icon-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.save-menu {
  width: 100%;
  justify-content: center;
  margin-top: 16px;
}

.tab-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  background: var(--bg);
  padding: 3px;
  border-radius: var(--radius);
}
.tab-btn {
  flex: 1;
  padding: 6px 10px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--muted);
  transition:
    background 0.15s,
    color 0.15s;
}
.tab-btn:hover {
  color: var(--fg);
}
.tab-btn.active {
  background: var(--surface);
  color: var(--fg);
  box-shadow: var(--shadow-sm);
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
</style>
