<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import { ApiError } from '@/lib/api';
import {
  redirectsApi,
  type CreateRedirectInput,
  type Redirect,
} from '@/api/redirects';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { confirm } = useConfirm();
const items = ref<Redirect[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const nextCursor = ref<string | null>(null);
const hasMore = ref(false);

// ── Add / edit form ──
const formOpen = ref(false);
const editingId = ref<string | null>(null);
const fromPath = ref('');
const toPath = ref('');
const redirectType = ref<301 | 302>(301);
const saving = ref(false);

// ── Search + filters (client-side over loaded rows) ──
const search = ref('');
const typeFilter = ref<'all' | '301' | '302'>('all');
const statusFilter = ref<'all' | 'active' | 'inactive'>('all');

const importing = ref(false);
const importResult = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const filtered = computed<Redirect[]>(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter((r) => {
    if (
      q &&
      !r.fromPath.toLowerCase().includes(q) &&
      !r.toPath.toLowerCase().includes(q)
    ) {
      return false;
    }
    if (typeFilter.value !== 'all' && String(r.redirectType) !== typeFilter.value) {
      return false;
    }
    if (statusFilter.value === 'active' && !r.isActive) return false;
    if (statusFilter.value === 'inactive' && r.isActive) return false;
    return true;
  });
});

async function loadFirst(): Promise<void> {
  loading.value = true;
  error.value = null;
  items.value = [];
  try {
    const res = await redirectsApi.list({ limit: 100 });
    items.value = res.data;
    nextCursor.value = res.pagination.nextCursor;
    hasMore.value = res.pagination.hasMore;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const res = await redirectsApi.list({ limit: 100, cursor: nextCursor.value });
    items.value.push(...res.data);
    nextCursor.value = res.pagination.nextCursor;
    hasMore.value = res.pagination.hasMore;
  } finally {
    loadingMore.value = false;
  }
}

function openAdd(): void {
  editingId.value = null;
  fromPath.value = '';
  toPath.value = '';
  redirectType.value = 301;
  error.value = null;
  formOpen.value = true;
}

function openEdit(r: Redirect): void {
  editingId.value = r.id;
  fromPath.value = r.fromPath;
  toPath.value = r.toPath;
  redirectType.value = r.redirectType === 302 ? 302 : 301;
  error.value = null;
  formOpen.value = true;
}

function closeForm(): void {
  formOpen.value = false;
  editingId.value = null;
  fromPath.value = '';
  toPath.value = '';
  redirectType.value = 301;
}

async function onSubmit(): Promise<void> {
  if (!fromPath.value || !toPath.value) return;
  saving.value = true;
  error.value = null;
  try {
    if (editingId.value) {
      const res = await redirectsApi.update(editingId.value, {
        fromPath: fromPath.value,
        toPath: toPath.value,
        redirectType: redirectType.value,
      });
      const idx = items.value.findIndex((x) => x.id === editingId.value);
      if (idx !== -1) items.value[idx] = res.data;
    } else {
      const res = await redirectsApi.create({
        fromPath: fromPath.value,
        toPath: toPath.value,
        redirectType: redirectType.value,
      });
      items.value.unshift(res.data);
    }
    closeForm();
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      error.value = 'A redirect for this from-path already exists.';
    } else if (e instanceof ApiError && e.status === 400) {
      error.value = 'Invalid redirect — check for self-redirects or loops.';
    } else {
      error.value = e instanceof Error ? e.message : 'Save failed';
    }
  } finally {
    saving.value = false;
  }
}

async function toggleActive(r: Redirect): Promise<void> {
  try {
    const res = await redirectsApi.update(r.id, { isActive: !r.isActive });
    const idx = items.value.findIndex((x) => x.id === r.id);
    if (idx !== -1) items.value[idx] = res.data;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Update failed');
  }
}

async function onDelete(r: Redirect): Promise<void> {
  const ok = await confirm({
    title: 'Delete redirect',
    message: `Delete redirect ${r.fromPath} → ${r.toPath}?`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await redirectsApi.remove(r.id);
    items.value = items.value.filter((x) => x.id !== r.id);
    if (editingId.value === r.id) closeForm();
    toast.success('Redirect deleted');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

function onPickCsv(): void {
  fileInput.value?.click();
}

// CSV columns: from_path,to_path[,redirect_type]. A header row is skipped.
async function onCsvChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importing.value = true;
  importResult.value = null;
  error.value = null;
  try {
    const text = await file.text();
    const rows = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.split(',').map((c) => c.trim()));
    let ok = 0;
    let failed = 0;
    for (const cols of rows) {
      const [from, to, type] = cols;
      if (!from || !to || from.toLowerCase() === 'from_path') continue;
      const payload: CreateRedirectInput = { fromPath: from, toPath: to };
      if (type === '302') payload.redirectType = 302;
      try {
        await redirectsApi.create(payload);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    importResult.value = `Imported ${ok} redirect(s), ${failed} skipped/failed.`;
    await loadFirst();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'CSV import failed';
  } finally {
    importing.value = false;
  }
}

onMounted(loadFirst);
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Redirects</h1>
        <p class="page-subtitle">
          {{ items.length }} redirect{{ items.length === 1 ? '' : 's' }}
        </p>
      </div>
      <div class="header-actions">
        <button type="button" class="btn btn-secondary" :disabled="importing" @click="onPickCsv">
          {{ importing ? 'Importing…' : 'Import CSV' }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          class="hidden-input"
          @change="onCsvChosen"
        />
        <button type="button" class="btn btn-primary" @click="openAdd">+ Add Redirect</button>
      </div>
    </header>

    <p v-if="importResult" class="state-msg">{{ importResult }}</p>

    <!-- Add / edit form (revealed by + Add Redirect or Edit) -->
    <form v-if="formOpen" class="card add-card" @submit.prevent="onSubmit">
      <input v-model="fromPath" type="text" placeholder="/old-path" class="form-input mono" />
      <span class="arrow">→</span>
      <input v-model="toPath" type="text" placeholder="/new-path or URL" class="form-input mono" />
      <select v-model.number="redirectType" class="form-select type-select">
        <option :value="301">301</option>
        <option :value="302">302</option>
      </select>
      <button type="submit" class="btn btn-primary" :disabled="saving">
        {{ saving ? 'Saving…' : editingId ? 'Save' : 'Add redirect' }}
      </button>
      <button type="button" class="btn btn-ghost" @click="closeForm">Cancel</button>
    </form>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading" class="state-msg">Loading…</p>
    <div v-else-if="items.length === 0" class="empty-state">
      <div class="empty-title">No redirects yet</div>
    </div>

    <div v-else class="table-wrap">
      <div class="table-toolbar">
        <div class="filter-bar">
          <label class="search-input">
            <Icon name="search" :size="15" />
            <input v-model="search" type="text" placeholder="Search redirects…" />
          </label>
          <select v-model="typeFilter" class="select-filter">
            <option value="all">All Types</option>
            <option value="301">301</option>
            <option value="302">302</option>
          </select>
          <select v-model="statusFilter" class="select-filter">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>From URL</th>
            <th>To URL</th>
            <th>Type</th>
            <th>Hits</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="6" class="no-match">No redirects match your filters.</td>
          </tr>
          <tr v-for="r in filtered" :key="r.id">
            <td>
              <button type="button" class="link-from" @click="openEdit(r)">{{ r.fromPath }}</button>
            </td>
            <td><span class="mono to-path">{{ r.toPath }}</span></td>
            <td>
              <span class="rtype" :class="r.redirectType === 301 ? 'rtype-301' : 'rtype-302'">
                {{ r.redirectType }}
              </span>
            </td>
            <td>{{ r.hitCount.toLocaleString() }}</td>
            <td>
              <button
                type="button"
                class="switch"
                :class="{ on: r.isActive }"
                role="switch"
                :aria-checked="r.isActive"
                :title="r.isActive ? 'Active' : 'Inactive'"
                @click="toggleActive(r)"
              />
            </td>
            <td>
              <div class="row-actions">
                <button type="button" class="icon-btn" title="Edit" aria-label="Edit" @click="openEdit(r)">
                  <Icon name="edit" :size="15" />
                </button>
                <button type="button" class="icon-btn icon-btn--danger" title="Delete" aria-label="Delete" @click="onDelete(r)">
                  <Icon name="trash" :size="15" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="table-footer">
        <button
          v-if="hasMore"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ loadingMore ? 'Loading…' : 'Load more' }}
        </button>
        <span v-else></span>
        <span class="footer-count">
          Showing {{ filtered.length }} of {{ items.length }} redirect{{ items.length === 1 ? '' : 's' }}
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hidden-input {
  display: none;
}
.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Add / edit form */
.add-card {
  margin-bottom: 16px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.add-card .form-input {
  flex: 1;
  min-width: 160px;
}
.type-select {
  width: auto;
  flex-shrink: 0;
}
.arrow {
  color: var(--muted);
  flex-shrink: 0;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
}

/* Balance the two path columns (override the shared "first column absorbs
   slack" rule so From and To read as equal, like the mockup). */
.table-wrap .table th:first-child,
.table-wrap .table td:first-child,
.table-wrap .table th:nth-child(2),
.table-wrap .table td:nth-child(2) {
  width: 34%;
}

.link-from {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  color: var(--info);
  text-align: left;
}
.link-from:hover {
  text-decoration: underline;
}
.to-path {
  color: var(--fg);
}

.rtype {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  font-weight: 600;
}
.rtype-301 {
  color: var(--info);
}
.rtype-302 {
  color: var(--warning);
}

/* Active toggle switch */
.switch {
  width: 36px;
  height: 20px;
  background: var(--border);
  border: none;
  border-radius: 10px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  padding: 0;
  flex-shrink: 0;
}
.switch.on {
  background: var(--success);
}
.switch::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  top: 3px;
  left: 3px;
  transition: transform 0.2s;
}
.switch.on::after {
  transform: translateX(16px);
}

/* Edit / Delete icon actions */
.row-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.no-match {
  text-align: center;
  color: var(--text-tertiary);
  padding: 28px 20px;
}

.table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--border-soft);
}
.footer-count {
  font-size: 12.5px;
  color: var(--muted);
  margin-left: auto;
}

.state-msg {
  color: var(--muted);
  font-size: 0.9rem;
}
.error-msg {
  color: var(--danger);
  font-size: 13px;
  margin: 0 0 12px;
}
</style>
