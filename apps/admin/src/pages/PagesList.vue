<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import DataTable, {
  type DataTableColumn,
} from '@/components/DataTable.vue';
import Icon from '@/components/Icon.vue';
import {
  pagesApi,
  type Page,
  type PageCounts,
  type PageSort,
  type PageStatus,
  type PageType,
  type SortDir,
} from '@/api/pages';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { useAuthStore } from '@/stores/auth';

// Pages list — DataTable-shell + page-specific cell slots. The "+ New Page"
// action routes to /pages/new (dedicated type chooser screen).

const router = useRouter();
const { confirm } = useConfirm();
const auth = useAuthStore();

// Public-site origin from the session (auth.publicWebUrl is sourced from
// siteSettings.siteUrl). Null = not configured; callers surface a clean
// "set Site URL in Site Settings" toast instead of opening a relative URL.
const publicOrigin = computed<string | null>(() => {
  const fromAuth = auth.publicWebUrl;
  return fromAuth && fromAuth.length > 0
    ? fromAuth.replace(/\/$/, '')
    : null;
});

const rows = ref<Page[]>([]);
const counts = ref<PageCounts>({ total: 0, published: 0, drafts: 0, dynamic: 0 });
const total = ref(0);
const loading = ref(false);
const loadError = ref<string | null>(null);

const q = ref('');
const filterType = ref<PageType | ''>('');
const filterStatus = ref<PageStatus | ''>('');

// DataTable speaks generic `string` for the sort key — keep ours as string
// here and cast back to PageSort when calling the API.
const sort = ref<string>('updated_at');
const dir = ref<SortDir>('desc');
const page = ref(1);
const limit = ref(10);

const selected = ref<Set<string>>(new Set());

const columns: DataTableColumn[] = [
  // Title takes ~half the table; the other columns are content-sized.
  { key: 'title', label: 'Title', sortable: true, width: '50%' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'updated_at', label: 'Updated', sortable: true },
  { key: 'actions', label: 'Actions', width: '140px', align: 'right' },
];

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput(v: string): void {
  q.value = v;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 250);
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const res = await pagesApi.list({
      ...(filterType.value ? { type: filterType.value } : {}),
      ...(filterStatus.value ? { status: filterStatus.value } : {}),
      ...(q.value.trim() ? { q: q.value.trim() } : {}),
      sort: sort.value as PageSort,
      dir: dir.value,
      page: page.value,
      limit: limit.value,
    });
    rows.value = res.data;
    counts.value = res.counts;
    total.value = res.pagination.total;
    // Drop any selection IDs that aren't on this page so the bulk bar count
    // never claims rows the user can't see.
    const present = new Set(res.data.map((r) => r.id));
    const next = new Set<string>();
    for (const id of selected.value) if (present.has(id)) next.add(id);
    selected.value = next;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

watch([filterType, filterStatus, sort, dir], () => {
  page.value = 1;
  void load();
});
watch([page, limit], () => void load());

const bulkBusy = ref(false);

async function bulkTransition(toStatus: PageStatus, label: string): Promise<void> {
  if (bulkBusy.value || selected.value.size === 0) return;
  const ids = Array.from(selected.value);
  bulkBusy.value = true;
  const results = await Promise.allSettled(
    ids.map((id) => pagesApi.transition(id, { toStatus })),
  );
  bulkBusy.value = false;
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - ok;
  if (ok > 0) toast.success(`${label} ${ok} page${ok === 1 ? '' : 's'}`);
  if (failed > 0) toast.error(`${failed} could not be ${label.toLowerCase()}`);
  selected.value = new Set();
  await load();
}

async function bulkDelete(): Promise<void> {
  if (bulkBusy.value || selected.value.size === 0) return;
  const deletable = rows.value.filter(
    (r) => selected.value.has(r.id) && !r.systemManaged,
  );
  if (deletable.length === 0) {
    toast.error('Selected pages are system-managed and cannot be deleted.');
    return;
  }
  const skipped = selected.value.size - deletable.length;
  const ok = await confirm({
    title: 'Delete pages',
    message: `Delete ${deletable.length} page${deletable.length === 1 ? '' : 's'}? This is a soft delete — rows remain for audit but are hidden from the public site immediately.${skipped > 0 ? ` ${skipped} system-managed page${skipped === 1 ? '' : 's'} will be skipped.` : ''}`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  bulkBusy.value = true;
  const results = await Promise.allSettled(
    deletable.map((r) => pagesApi.remove(r.id)),
  );
  bulkBusy.value = false;
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - okCount;
  if (okCount > 0) toast.success(`Deleted ${okCount} page${okCount === 1 ? '' : 's'}`);
  if (failed > 0) toast.error(`${failed} could not be deleted`);
  selected.value = new Set();
  await load();
}

function onNew(): void {
  void router.push({ name: 'pages-new' });
}

async function onDuplicate(p: Page): Promise<void> {
  try {
    const copy = await pagesApi.duplicate(p.id);
    toast.success(`Duplicated as "${copy.title}"`);
    await load();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Duplicate failed');
  }
}

async function onDelete(p: Page): Promise<void> {
  if (p.systemManaged) return;
  const ok = await confirm({
    title: 'Delete page',
    message: `Delete "${p.title || p.slug}"? This is a soft delete — the row remains for audit but is hidden from the public site immediately.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await pagesApi.remove(p.id);
    toast.success('Page deleted');
    await load();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

function editRoute(p: Page): { name: string; params: { id: string } } {
  return {
    name: p.type === 'static' ? 'page-edit-static' : 'page-edit-dynamic',
    params: { id: p.id },
  };
}

function onView(p: Page): void {
  // Public Nuxt site is a separate origin from the admin (admin is :5173,
  // public is :3001 in dev / a separate domain in prod). publicOrigin
  // resolves to the absolute base via /admin/auth/me (sourced from
  // siteSettings.siteUrl). If unset, surface the misconfiguration instead of
  // silently opening a relative URL against :5173.
  if (p.status === 'published') {
    const origin = publicOrigin.value;
    if (!origin) {
      toast.error(
        'Public site URL is not configured — set Site URL in Site Settings.',
      );
      return;
    }
    window.open(`${origin}/${p.slug}`, '_blank', 'noopener,noreferrer');
    return;
  }
  // Draft / not-yet-published — the public route filters out anything that
  // isn't published, so we have to go through the same signed preview-token
  // flow the editor's "Preview" button uses. The token URL is absolute and
  // already includes ?preview=… so we don't add anything.
  void pagesApi
    .previewToken(p.id)
    .then(({ data }) => {
      window.open(data.previewUrl, '_blank', 'noopener,noreferrer');
    })
    .catch((e) => {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    });
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
function formatUpdated(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return { date: DATE_FMT.format(d), time: TIME_FMT.format(d) };
}

const emptyTitle = computed(() =>
  q.value.trim() || filterType.value || filterStatus.value
    ? 'No pages match your filters'
    : 'No pages yet',
);
const emptyHint = computed(() =>
  q.value.trim() || filterType.value || filterStatus.value
    ? 'Try adjusting your search or filters'
    : 'Click "New Page" to create one',
);
const resultLabel = computed(() =>
  loading.value ? 'Loading…' : `${total.value} page${total.value === 1 ? '' : 's'}`,
);

// The "Theme & system routes" panel moved to Theme Settings (Structure →
// Theme Settings) — the Pages list now shows only editable pages.

onMounted(() => {
  void load();
});
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1 class="page-title">Pages</h1>
        <div class="page-subtitle">Manage static and dynamic pages on your site</div>
      </div>
      <div class="page-header-actions">
        <RouterLink
          :to="{ name: 'pages-help-blocks' }"
          class="btn btn-secondary"
          title="Open the developer guide for adding new blocks to the dynamic editor"
        >
          <Icon name="help" :size="13" />
          How to add blocks
        </RouterLink>
        <button type="button" class="btn btn-primary" @click="onNew">
          <Icon name="plus" :size="13" />
          New Page
        </button>
      </div>
    </div>

    <div class="stat-grid pages-stats">
      <div class="stat-card stat-tile">
        <div class="stat-icon" style="background: var(--info-soft);">📄</div>
        <div>
          <span class="stat-label">Total Pages</span>
          <span class="stat-value">{{ counts.total }}</span>
        </div>
      </div>
      <div class="stat-card stat-tile">
        <div class="stat-icon" style="background: var(--success-soft);">✅</div>
        <div>
          <span class="stat-label">Published</span>
          <span class="stat-value">{{ counts.published }}</span>
        </div>
      </div>
      <div class="stat-card stat-tile">
        <div class="stat-icon" style="background: #f3f4f6;">📝</div>
        <div>
          <span class="stat-label">Drafts</span>
          <span class="stat-value">{{ counts.drafts }}</span>
        </div>
      </div>
      <div class="stat-card stat-tile">
        <div class="stat-icon" style="background: var(--purple-soft);">🧩</div>
        <div>
          <span class="stat-label">Dynamic</span>
          <span class="stat-value">{{ counts.dynamic }}</span>
        </div>
      </div>
    </div>

    <p v-if="loadError" class="load-error">{{ loadError }}</p>

    <DataTable
      v-model:page="page"
      v-model:limit="limit"
      v-model:sort="sort"
      v-model:dir="dir"
      v-model:selected="selected"
      :rows="rows"
      :columns="columns"
      :row-key="(r: Page) => r.id"
      :total="total"
      :loading="loading"
      :selectable="true"
      bulk-noun="page"
      :result-label="resultLabel"
      :empty-title="emptyTitle"
      :empty-hint="emptyHint"
      empty-icon="📄"
    >
      <template #toolbar>
        <label class="search-input">
          <Icon name="search" :size="13" />
          <input
            type="text"
            placeholder="Search pages…"
            :value="q"
            @input="(e) => onSearchInput((e.target as HTMLInputElement).value)"
          />
        </label>
        <select v-model="filterType" class="select-filter">
          <option value="">Type: All</option>
          <option value="static">Static</option>
          <option value="dynamic">Dynamic</option>
        </select>
        <select v-model="filterStatus" class="select-filter">
          <option value="">Status: All</option>
          <option value="draft">Draft</option>
          <option value="in_review">In review</option>
          <option value="approved">Approved</option>
          <option value="scheduled">Scheduled</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </template>

      <template #bulk>
        <button
          type="button"
          class="bulk-btn"
          :disabled="bulkBusy"
          @click="bulkTransition('published', 'Published')"
        >
          Publish
        </button>
        <button
          type="button"
          class="bulk-btn"
          :disabled="bulkBusy"
          @click="bulkTransition('archived', 'Archived')"
        >
          Archive
        </button>
        <button
          type="button"
          class="bulk-btn danger"
          :disabled="bulkBusy"
          @click="bulkDelete"
        >
          Delete
        </button>
      </template>

      <template #cell:title="{ row }">
        <div class="page-title-cell">
          <div class="page-type-icon" :class="(row as Page).type">
            {{ (row as Page).type === 'dynamic' ? '🧩' : '📄' }}
          </div>
          <div class="page-title-text">
            <div class="page-name-row">
              <RouterLink
                :to="editRoute(row as Page)"
                class="page-name"
                :class="{ untitled: !(row as Page).title }"
              >
                {{ (row as Page).title || 'Untitled page' }}
              </RouterLink>
              <span
                v-if="(row as Page).systemManaged"
                class="system-pill"
                title="System-managed — cannot be deleted"
              >
                system
              </span>
            </div>
            <div class="page-slug">
              {{ (row as Page).slug.startsWith('/') ? (row as Page).slug : `/${(row as Page).slug}` }}
            </div>
          </div>
        </div>
      </template>

      <template #cell:type="{ row }">
        <span class="badge" :class="`badge-${(row as Page).type}`">
          {{ (row as Page).type }}
        </span>
      </template>

      <template #cell:status="{ row }">
        <span class="badge" :class="`badge-${(row as Page).status}`">
          {{ (row as Page).status.replace('_', ' ') }}
        </span>
      </template>

      <template #cell:updated_at="{ row }">
        <div class="updated-cell">
          <div class="updated-main">{{ formatUpdated((row as Page).updatedAt).date }}</div>
          <div class="updated-time">{{ formatUpdated((row as Page).updatedAt).time }}</div>
        </div>
      </template>

      <template #cell:actions="{ row }">
        <div class="action-btns">
          <RouterLink
            :to="editRoute(row as Page)"
            class="icon-btn"
            title="Edit"
            aria-label="Edit"
          >
            <Icon name="edit" :size="13" />
          </RouterLink>
          <button
            type="button"
            class="icon-btn"
            title="Duplicate"
            aria-label="Duplicate"
            @click="onDuplicate(row as Page)"
          >
            <Icon name="copy" :size="13" />
          </button>
          <button
            type="button"
            class="icon-btn"
            title="View page"
            aria-label="View page"
            @click="onView(row as Page)"
          >
            <Icon name="external" :size="13" />
          </button>
          <button
            v-if="!(row as Page).systemManaged"
            type="button"
            class="icon-btn icon-btn--danger"
            title="Delete"
            aria-label="Delete"
            @click="onDelete(row as Page)"
          >
            <Icon name="trash" :size="13" />
          </button>
        </div>
      </template>
    </DataTable>

  </section>
</template>

<style scoped>
/* Right-side action cluster on the page header. The base .page-header is
   flex space-between, so we just need an inline row so the help link and
   the primary CTA sit beside each other. */
.page-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.pages-stats {
  margin-bottom: 20px;
}
.stat-tile {
  padding: 16px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.stat-tile .stat-icon {
  width: 38px;
  height: 38px;
  font-size: 16px;
  margin-bottom: 0;
  border-radius: 10px;
}
.stat-tile .stat-value {
  font-size: 22px;
  margin-top: 2px;
}

.load-error {
  margin: 0 0 12px;
  color: var(--danger);
  font-size: 13px;
}

.page-title-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}
.page-type-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.page-type-icon.static {
  background: var(--info-soft);
}
.page-type-icon.dynamic {
  background: var(--purple-soft);
}
.page-title-text {
  min-width: 0;
}
.page-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--fg);
  text-decoration: none;
  line-height: 1.3;
}
.page-name:hover {
  color: var(--accent-hover);
}
.page-name.untitled {
  color: var(--text-tertiary);
  font-style: italic;
  font-weight: 400;
}
.page-slug {
  font-size: 11.5px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, monospace;
  margin-top: 1px;
}
.system-pill {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--muted);
}

.updated-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.updated-main {
  font-size: 13px;
  color: var(--fg);
}
.updated-time {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* Action buttons are always visible per design. Sized down slightly to fit
   four icon buttons in a 140px right-aligned cell without crowding. */
.action-btns {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}
.action-btns .icon-btn {
  width: 28px;
  height: 28px;
}

</style>
