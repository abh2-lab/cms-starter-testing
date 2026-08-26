<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import DataTable, {
  type DataTableColumn,
} from '@/components/DataTable.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/lib/api';
import {
  contentApi,
  CONTENT_STATUSES,
  type Content,
  type ContentCounts,
  type ContentSort,
  type ContentStatus,
  type ListContentParams,
  type SortDir,
} from '@/api/content';
import {
  contentTypesApi,
  readSlugList,
  type ContentType,
} from '@/api/content-types';
import { useTaxonomyTerms } from '@/composables/useTaxonomyTerms';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { useAuthStore } from '@/stores/auth';
import ContentTypePickerModal from '@/components/ContentTypePickerModal.vue';
import ContentReorderModal from '@/components/ContentReorderModal.vue';
import InformationTable from '@/components/InformationTable.vue';

const auth = useAuthStore();
const { confirm } = useConfirm();
const items = ref<Content[]>([]);
const types = ref<ContentType[]>([]);
const counts = ref<ContentCounts>({
  total: 0,
  published: 0,
  drafts: 0,
  inReview: 0,
  scheduled: 0,
});
const loading = ref(false);
const error = ref<string | null>(null);

// Offset-based numbered pagination (see DataTable). `limit` defaults to 10 and
// is user-adjustable via the footer rows-per-page selector.
const page = ref(1);
const limit = ref(10);
const total = ref(0);

// Column sort — mirrors the Pages list. Default: most recently updated first.
// The values match the sortable DataTable column `key`s (and the API param).
const sort = ref<string>('updated_at');
const dir = ref<SortDir>('desc');

// Bulk selection (checkbox column + bulk-action bar in DataTable).
const selected = ref<Set<string>>(new Set());
const bulkBusy = ref(false);

const route = useRoute();
const router = useRouter();

// Category filter — the terms come from the SELECTED content type's category
// taxonomy, so the dropdown only appears once a type is chosen (and only if
// that type binds a category taxonomy). Loaded once, module-cached.
const { groups: taxonomyGroups, ensureLoaded: ensureTaxonomies } =
  useTaxonomyTerms();

// "+ New Content" type chooser. With a single content type there's nothing to
// choose, so the button skips the modal and goes straight to the editor.
const pickerOpen = ref(false);

function onNewContent(): void {
  const only = types.value.length === 1 ? types.value[0] : null;
  if (only) {
    void router.push({ name: 'content-create', params: { typeId: only.id } });
    return;
  }
  pickerOpen.value = true;
}

function onPickType(t: ContentType): void {
  pickerOpen.value = false;
  void router.push({ name: 'content-create', params: { typeId: t.id } });
}

// `?create=1` opens the picker on arrival — used by the Home quick action and
// the legacy /content/new redirect. The query is stripped first so back/refresh
// doesn't re-open the modal.
async function handleCreateQuery(): Promise<void> {
  if (route.query['create'] !== '1') return;
  const { create: _create, ...rest } = route.query;
  await router.replace({ query: rest });
  onNewContent();
}

function queryType(): string {
  const t = route.query['type'];
  return typeof t === 'string' ? t : '';
}
function queryStatus(): ContentStatus | '' {
  const s = route.query['status'];
  return typeof s === 'string' &&
    (CONTENT_STATUSES as readonly string[]).includes(s)
    ? (s as ContentStatus)
    : '';
}

const filterStatus = ref<ContentStatus | ''>(queryStatus());
const filterTypeId = ref<string>(queryType());
const filterQ = ref('');
const filterSubmittedBy = ref<'' | 'user' | 'guest'>('');
const filterTermId = ref<string>('');

const typesById = computed(() =>
  Object.fromEntries(types.value.map((t) => [t.id, t])),
);

// Manual-order UI. Any content type with settings.manualOrder enabled gets the
// Reorder button; its public listing then reads that order via the archive's
// manualOrder branch.
const reorderOpen = ref(false);
const orderableType = computed(() => {
  const t = filterTypeId.value ? typesById.value[filterTypeId.value] : null;
  return t?.settings?.manualOrder === true ? t : null;
});
async function onReordered(): Promise<void> {
  reorderOpen.value = false;
  toast.success('Order saved');
  await load();
}

// An "information-collection" submission type shows the submissions table + CSV
// instead of the post list. Kind defaults to 'information', so gate on
// submissions being enabled AND the kind not explicitly set to 'post'.
const informationType = computed(() => {
  const t = filterTypeId.value ? typesById.value[filterTypeId.value] : null;
  if (!t || t.submissionAccess === 'none') return null;
  return (t.settings?.submissionKind ?? 'information') === 'information'
    ? t
    : null;
});
// The table's columns ARE the content type's fields (in field order). Each
// submission stores its values under these field names, so a column reads
// customFields[field.name]. No fields defined → the table falls back to
// name/email on its own.
const informationFields = computed<{ name: string; label: string }[]>(() => {
  const t = informationType.value;
  if (!t) return [];
  return t.fieldDefinitions.fields
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ name: f.name, label: f.label }));
});

// Category terms for the selected type. A content type binds its category
// taxonomies under settings.taxonomies.categories (slug or slug[]); we collect
// every term of those taxonomies, flattened with a depth for indentation.
const categoryTerms = computed<{ id: string; name: string; depth: number }[]>(
  () => {
    const t = typesById.value[filterTypeId.value];
    if (!t) return [];
    const slugs = readSlugList(t.settings?.taxonomies?.categories);
    if (slugs.length === 0) return [];
    const out: { id: string; name: string; depth: number }[] = [];
    for (const group of taxonomyGroups.value) {
      if (!slugs.includes(group.taxonomy.slug)) continue;
      for (const term of group.terms) {
        out.push({ id: term.id, name: term.name, depth: term.depth });
      }
    }
    return out;
  },
);

// Title + Updated are sortable; the keys double as the API sort param.
const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', width: '46%', sortable: true },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'updated_at', label: 'Updated', sortable: true },
  { key: 'actions', label: 'Actions', width: '150px', align: 'right' },
];

function listParams(): ListContentParams {
  return {
    page: page.value,
    limit: limit.value,
    ...(filterStatus.value ? { status: filterStatus.value } : {}),
    ...(filterTypeId.value ? { contentTypeId: filterTypeId.value } : {}),
    ...(filterQ.value.trim() ? { q: filterQ.value.trim() } : {}),
    ...(filterSubmittedBy.value
      ? { submittedBy: filterSubmittedBy.value }
      : {}),
    ...(filterTermId.value ? { taxonomyTermId: filterTermId.value } : {}),
    ...(sort.value ? { sort: sort.value as ContentSort } : {}),
    dir: dir.value,
  };
}

async function loadTypes(): Promise<void> {
  try {
    const res = await contentTypesApi.list();
    types.value = res.data;
  } catch {
    // non-fatal — filter dropdown stays empty
  }
}

async function loadCounts(): Promise<void> {
  try {
    const res = await contentApi.counts();
    counts.value = res.data;
  } catch {
    // non-fatal — the stat strip just shows zeros
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await contentApi.list(listParams());
    items.value = res.data;
    total.value = res.pagination.total;
    // Drop any selection ids that aren't on this page so the bulk bar count
    // never claims rows the user can't see (mirrors the Pages list).
    const present = new Set(res.data.map((r) => r.id));
    const next = new Set<string>();
    for (const id of selected.value) if (present.has(id)) next.add(id);
    selected.value = next;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput(v: string): void {
  filterQ.value = v;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 250);
}

// ─── Bulk actions ──────────────────────────────────────────────────────────
// Status changes go through the same per-row transition endpoint the editor
// uses, looped over the selection. The content state machine gates each one,
// so a bulk Publish on an already-published (or field-incomplete) row fails
// for that row only — Promise.allSettled keeps the rest going and we report
// how many succeeded vs. couldn't.

async function bulkTransition(
  toStatus: ContentStatus,
  label: string,
): Promise<void> {
  if (bulkBusy.value || selected.value.size === 0) return;
  const ids = Array.from(selected.value);
  bulkBusy.value = true;
  const results = await Promise.allSettled(
    ids.map((id) => contentApi.transition(id, { toStatus })),
  );
  bulkBusy.value = false;
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - ok;
  if (ok > 0) toast.success(`${label} ${ok} item${ok === 1 ? '' : 's'}`);
  if (failed > 0)
    toast.error(`${failed} could not be ${label.toLowerCase()}`);
  selected.value = new Set();
  await Promise.all([load(), loadCounts()]);
}

async function bulkDelete(): Promise<void> {
  if (bulkBusy.value || selected.value.size === 0) return;
  const ids = Array.from(selected.value);
  const ok = await confirm({
    title: 'Delete content',
    message: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  bulkBusy.value = true;
  const results = await Promise.allSettled(
    ids.map((id) => contentApi.remove(id)),
  );
  bulkBusy.value = false;
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - okCount;
  if (okCount > 0)
    toast.success(`Deleted ${okCount} item${okCount === 1 ? '' : 's'}`);
  if (failed > 0) toast.error(`${failed} could not be deleted`);
  selected.value = new Set();
  await Promise.all([load(), loadCounts()]);
}

async function onDuplicate(item: Content): Promise<void> {
  try {
    const res = await contentApi.duplicate(item.id);
    toast.success(`Duplicated as "${res.data.title}"`);
    await Promise.all([load(), loadCounts()]);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Duplicate failed');
  }
}

// Public-site origin from the session (auth.publicWebUrl is sourced from
// siteSettings.siteUrl on the API side). Null = not configured.
const publicOrigin = computed<string | null>(() => {
  const fromAuth = auth.publicWebUrl;
  return fromAuth && fromAuth.length > 0
    ? fromAuth.replace(/\/$/, '')
    : null;
});

function previewTemplate(item: Content): string | null {
  return typesById.value[item.contentTypeId]?.previewPath ?? null;
}

// Mirror of buildPreviewPath in apps/api/src/lib/preview-routes.ts. Kept
// inline to avoid a workspace dep just for one regex substitution. `{category}`
// falls back to `uncategorized` to match the API helper and the public
// articleUrl() behaviour.
function substituteSlug(
  template: string,
  slug: string,
  categorySlug?: string | null,
): string {
  const category =
    categorySlug && categorySlug.length > 0 ? categorySlug : 'uncategorized';
  return template
    .replace(/\{slug\}/g, encodeURIComponent(slug))
    .replace(/\{category\}/g, encodeURIComponent(category));
}

function viewOnSiteDisabledReason(item: Content): string | null {
  if (!previewTemplate(item)) {
    return 'Preview not configured for this content type — set previewPath on the content type to enable.';
  }
  if (!publicOrigin.value) {
    return 'Public site URL is not configured — set Site URL in Site Settings.';
  }
  return null;
}

async function onViewOnSite(item: Content): Promise<void> {
  const reason = viewOnSiteDisabledReason(item);
  if (reason) {
    toast.error(reason);
    return;
  }
  const template = previewTemplate(item);
  if (!template || !publicOrigin.value) return; // narrows for TS
  try {
    if (item.status === 'published') {
      // Public URL, no token needed — opens what an anonymous visitor sees.
      const url = `${publicOrigin.value}${substituteSlug(template, item.slug, item.primaryCategorySlug)}`;
      window.open(url, '_blank', 'noopener');
      return;
    }
    // Drafts/scheduled/archived need a signed preview token — same code path
    // as the editor's Preview button.
    const { data } = await contentApi.previewToken(item.id);
    window.open(data.previewUrl, '_blank', 'noopener');
  } catch (e) {
    if (
      e instanceof ApiError &&
      e.status === 422 &&
      e.body &&
      typeof e.body === 'object' &&
      'error' in e.body &&
      e.body.error === 'no_public_route'
    ) {
      toast.error('Preview is not configured for this content type yet.');
      return;
    }
    toast.error(e instanceof Error ? e.message : 'Failed to open preview');
  }
}

async function onDelete(item: Content): Promise<void> {
  const ok = await confirm({
    title: 'Delete content',
    message: `Delete "${item.title}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await contentApi.remove(item.id);
    toast.success('Content deleted');
    // Reload so the count + pagination stay accurate; step back a page if we
    // just removed the last row on the final page.
    if (items.value.length === 1 && page.value > 1) page.value -= 1;
    else await load();
    void loadCounts();
  } catch (e) {
    toast.error(
      `Delete failed: ${
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'unknown'
      }`,
    );
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

const hasFilters = computed(
  () =>
    !!(
      filterQ.value.trim() ||
      filterStatus.value ||
      filterTypeId.value ||
      filterSubmittedBy.value ||
      filterTermId.value
    ),
);
const emptyTitle = computed(() =>
  hasFilters.value ? 'No content matches your filters' : 'No content yet',
);
const emptyHint = computed(() =>
  hasFilters.value
    ? 'Try adjusting your search or filters'
    : 'Click "New Content" to create one',
);
const resultLabel = computed(() =>
  loading.value
    ? 'Loading…'
    : `${total.value} item${total.value === 1 ? '' : 's'}`,
);

// Switching content type invalidates the category filter (the category belongs
// to the old type's taxonomy). This is registered BEFORE the reload watch on
// purpose: watchers fire in creation order, so the clear lands first and the
// reload below then reads the cleared filterTermId — one correct load, with no
// flash of the old category applied to the new type.
watch(filterTypeId, () => {
  filterTermId.value = '';
});
watch([filterStatus, filterTypeId, filterSubmittedBy, filterTermId, sort, dir], () => {
  page.value = 1;
  void load();
});
watch([page, limit], () => void load());
watch(
  () => route.query['type'],
  () => {
    filterTypeId.value = queryType();
  },
);
watch(
  () => route.query['status'],
  () => {
    filterStatus.value = queryStatus();
  },
);

watch(
  () => route.query['create'],
  (v) => {
    // Re-entry while already mounted (e.g. Home quick action from this tab).
    if (v === '1' && !loading.value) void handleCreateQuery();
  },
);

onMounted(async () => {
  await Promise.all([loadTypes(), load(), loadCounts(), ensureTaxonomies()]);
  await handleCreateQuery();
});
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Content</h1>
        <p class="page-subtitle">Manage and review all content</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button
          v-if="orderableType"
          type="button"
          class="btn btn-secondary"
          @click="reorderOpen = true"
        >
          <Icon name="align-justify" :size="14" /> Reorder
        </button>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="new-content"
          @click="onNewContent"
        >
          <Icon name="plus" :size="14" /> New Content
        </button>
      </div>
    </header>

    <div class="stat-grid content-stats">
      <div class="stat-card stat-tile">
        <div class="stat-icon" style="background: var(--info-soft);">📄</div>
        <div>
          <span class="stat-label">Total</span>
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
        <div class="stat-icon" style="background: var(--purple-soft);">👀</div>
        <div>
          <span class="stat-label">In review</span>
          <span class="stat-value">{{ counts.inReview }}</span>
        </div>
      </div>
    </div>

    <ContentTypePickerModal
      :open="pickerOpen"
      :types="types"
      @close="pickerOpen = false"
      @select="onPickType"
    />

    <ContentReorderModal
      :open="reorderOpen"
      :content-type="orderableType"
      @close="reorderOpen = false"
      @saved="onReordered"
    />

    <p v-if="error" class="load-error">{{ error }}</p>

    <!-- Information-collection type: a submissions table + CSV instead of the
         post list. A standalone Type dropdown stays so you can switch away. -->
    <div v-if="informationType" class="info-view">
      <div
        style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px"
      >
        <span style="font-size: 13px; color: var(--muted)">Type</span>
        <select v-model="filterTypeId" class="select-filter">
          <option value="">All types</option>
          <option v-for="t in types" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </select>
      </div>
      <InformationTable
        :key="informationType.id"
        :content-type-id="informationType.id"
        :content-type-name="informationType.name"
        :fields="informationFields"
      />
    </div>

    <DataTable
      v-else
      v-model:page="page"
      v-model:limit="limit"
      v-model:sort="sort"
      v-model:dir="dir"
      v-model:selected="selected"
      :rows="items"
      :columns="columns"
      :row-key="(r: Content) => r.id"
      :total="total"
      :loading="loading"
      :selectable="true"
      bulk-noun="item"
      :result-label="resultLabel"
      :empty-title="emptyTitle"
      :empty-hint="emptyHint"
      empty-icon="📄"
    >
      <template #toolbar>
        <label class="search-input">
          <Icon name="search" :size="13" />
          <input
            type="search"
            placeholder="Search content…"
            :value="filterQ"
            @input="(e) => onSearchInput((e.target as HTMLInputElement).value)"
          />
        </label>
        <select v-model="filterStatus" class="select-filter">
          <option value="">All statuses</option>
          <option v-for="s in CONTENT_STATUSES" :key="s" :value="s">
            {{ humanize(s) }}
          </option>
        </select>
        <select v-model="filterTypeId" class="select-filter">
          <option value="">All types</option>
          <option v-for="t in types" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </select>
        <select
          v-if="categoryTerms.length > 0"
          v-model="filterTermId"
          class="select-filter"
        >
          <option value="">All categories</option>
          <option v-for="term in categoryTerms" :key="term.id" :value="term.id">
            {{ '— '.repeat(term.depth) }}{{ term.name }}
          </option>
        </select>
        <select v-model="filterSubmittedBy" class="select-filter">
          <option value="">All sources</option>
          <option value="user">Submitted by: logged-in user</option>
          <option value="guest">Submitted by: guest</option>
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
        <RouterLink
          :to="{ name: 'content-edit', params: { id: (row as Content).id } }"
          class="row-link"
        >
          {{ (row as Content).title }}
        </RouterLink>
        <span class="slug">{{ (row as Content).slug }}</span>
      </template>

      <template #cell:type="{ row }">
        {{ typesById[(row as Content).contentTypeId]?.name ?? '—' }}
      </template>

      <template #cell:status="{ row }">
        <span class="badge" :class="`badge-${(row as Content).status}`">
          {{ humanize((row as Content).status) }}
        </span>
      </template>

      <template #cell:updated_at="{ row }">
        <span class="mono cell-muted">
          {{ formatDate((row as Content).updatedAt) }}
        </span>
      </template>

      <template #cell:actions="{ row }">
        <div class="actions">
          <RouterLink
            :to="{ name: 'content-edit', params: { id: (row as Content).id } }"
            class="icon-btn"
            title="Edit"
            aria-label="Edit"
          >
            <Icon name="edit" />
          </RouterLink>
          <button
            type="button"
            class="icon-btn"
            title="Duplicate"
            aria-label="Duplicate"
            @click="onDuplicate(row as Content)"
          >
            <Icon name="copy" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :class="{
              'icon-btn--disabled': !!viewOnSiteDisabledReason(row as Content),
            }"
            :disabled="!!viewOnSiteDisabledReason(row as Content)"
            :aria-disabled="!!viewOnSiteDisabledReason(row as Content)"
            :title="
              viewOnSiteDisabledReason(row as Content) ??
              ((row as Content).status === 'published'
                ? 'View on public site'
                : 'Preview on public site (signed link)')
            "
            :aria-label="
              (row as Content).status === 'published'
                ? 'View on public site'
                : 'Preview on public site'
            "
            @click="onViewOnSite(row as Content)"
          >
            <Icon name="external" />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn--danger"
            title="Delete"
            aria-label="Delete"
            @click="onDelete(row as Content)"
          >
            <Icon name="trash" />
          </button>
        </div>
      </template>
    </DataTable>
  </section>
</template>

<style scoped>
/* Stat strip — same sizing as the Pages list so the two screens match. */
.content-stats {
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

.row-link {
  font-weight: 500;
  text-decoration: none;
  color: var(--fg);
}
.row-link:hover {
  color: var(--accent-hover);
}
.slug {
  display: block;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.cell-muted {
  color: var(--muted);
  white-space: nowrap;
}
.load-error {
  margin: 0 0 12px;
  color: var(--danger);
  font-size: 13px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}
/* Four icon buttons in a 150px right-aligned cell — size them down a touch so
   they don't crowd (same approach as the Pages list). */
.actions .icon-btn {
  width: 30px;
  height: 30px;
}

/* Read-as-disabled visual for the View-on-site button when the content
 * type has no previewPath. The default .icon-btn:disabled styling can look
 * like a transient loading state; this makes the unavailability obvious. */
.icon-btn--disabled {
  color: var(--text-tertiary) !important;
  background: var(--surface-muted, transparent) !important;
  cursor: not-allowed !important;
  opacity: 0.55;
}
.icon-btn--disabled:hover {
  background: var(--surface-muted, transparent) !important;
  color: var(--text-tertiary) !important;
}
</style>
