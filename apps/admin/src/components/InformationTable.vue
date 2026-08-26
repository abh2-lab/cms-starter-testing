<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { contentApi, type Content } from '@/api/content';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

// Spreadsheet-style view of an "information-collection" content type's public
// submissions, with CSV export and row deletes. Columns come from the content
// TYPE's field definitions (one per field), plus a Submitted time column. Each
// submission stores its values in content.custom_fields keyed by field name
// (see public/submissions.ts), so a cell is just customFields[fieldName].
// Deletes reuse the normal DELETE /admin/content/:id, so they land in the
// Activity log exactly like a post delete. Rendered by ContentList in place of
// the post DataTable for information types.
const props = defineProps<{
  contentTypeId: string;
  contentTypeName?: string;
  // The content type's fields, in order — one column each.
  fields: { name: string; label: string }[];
}>();

const { confirm } = useConfirm();

interface Row {
  id: string;
  values: Record<string, unknown>;
  date: string;
}

const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(false);
const exporting = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

// Bulk selection (checkbox column) — drives the "Delete N" button.
const selected = ref<Set<string>>(new Set());
const allSelected = computed(
  () => rows.value.length > 0 && selected.value.size === rows.value.length,
);

// Fall back to Name/Email (from the submitter provenance) when the type hasn't
// defined its own fields yet, so the table is never blank.
const usingFallback = computed(() => props.fields.length === 0);
const columns = computed<{ name: string; label: string }[]>(() =>
  props.fields.length > 0
    ? props.fields
    : [
        { name: 'submitter_name', label: 'Name' },
        { name: 'submitter_email', label: 'Email' },
      ],
);

function toRow(c: Content): Row {
  return {
    id: c.id,
    values: c.customFields ?? {},
    date: c.createdAt,
  };
}
function cell(row: Row, name: string): string {
  const v = row.values[name];
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // custom_fields is jsonb, so a field can legitimately hold an object or an
  // array (a kv_list, a media gallery). String() renders those as the useless
  // "[object Object]" — show the actual content instead.
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function toggleAll(): void {
  selected.value = allSelected.value
    ? new Set()
    : new Set(rows.value.map((r) => r.id));
}
function toggleOne(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    // Show the latest 100; CSV export pulls every row.
    const res = await contentApi.list({
      contentTypeId: props.contentTypeId,
      limit: 100,
      page: 1,
      sort: 'created_at',
      dir: 'desc',
    });
    rows.value = res.data.map(toRow);
    total.value = res.pagination.total;
    // Drop selection ids that are no longer on the page (e.g. after a delete).
    const present = new Set(rows.value.map((r) => r.id));
    const next = new Set<string>();
    for (const id of selected.value) if (present.has(id)) next.add(id);
    selected.value = next;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load submissions';
  } finally {
    loading.value = false;
  }
}

// Loop pages (list limit caps at 200) so the CSV covers every submission.
async function fetchAll(): Promise<Row[]> {
  const params = {
    contentTypeId: props.contentTypeId,
    limit: 200,
    sort: 'created_at' as const,
    dir: 'desc' as const,
  };
  const first = await contentApi.list({ ...params, page: 1 });
  const all: Content[] = [...first.data];
  for (let p = 2; p <= first.pagination.totalPages; p++) {
    const res = await contentApi.list({ ...params, page: p });
    all.push(...res.data);
  }
  return all.map(toRow);
}

// RFC-4180-ish: quote a field holding a comma, quote, CR or LF; double internal
// quotes.
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function exportCsv(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const data = await fetchAll();
    const cols = columns.value;
    const header = [...cols.map((c) => c.label), 'Submitted'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of data) {
      lines.push(
        [...cols.map((c) => cell(r, c.name)), r.date].map(csvCell).join(','),
      );
    }
    const blob = new Blob([lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = (props.contentTypeName ?? 'submissions')
      .toLowerCase()
      .replace(/\s+/g, '-');
    a.download = `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${data.length} row${data.length === 1 ? '' : 's'}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Export failed');
  } finally {
    exporting.value = false;
  }
}

async function deleteOne(row: Row): Promise<void> {
  const ok = await confirm({
    title: 'Delete submission',
    message: 'Delete this submission? This cannot be undone.',
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await contentApi.remove(row.id);
    toast.success('Submission deleted');
    await load();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

async function deleteSelected(): Promise<void> {
  if (deleting.value || selected.value.size === 0) return;
  const ids = Array.from(selected.value);
  const ok = await confirm({
    title: 'Delete submissions',
    message: `Delete ${ids.length} submission${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  deleting.value = true;
  // Each delete is its own DELETE /admin/content/:id, so each is logged to
  // Activity. allSettled keeps going if one fails; we report the tally.
  const results = await Promise.allSettled(
    ids.map((id) => contentApi.remove(id)),
  );
  deleting.value = false;
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - okCount;
  if (okCount > 0)
    toast.success(`Deleted ${okCount} submission${okCount === 1 ? '' : 's'}`);
  if (failed > 0) toast.error(`${failed} could not be deleted`);
  selected.value = new Set();
  await load();
}

watch([() => props.contentTypeId, () => props.fields], () => void load());
onMounted(() => void load());
</script>

<template>
  <div class="info-table-wrap">
    <div class="info-table-bar">
      <span class="info-table-count">
        {{ total }} submission{{ total === 1 ? '' : 's' }}
        <template v-if="selected.size > 0"
          >· {{ selected.size }} selected</template
        >
      </span>
      <div class="info-table-actions">
        <button
          v-if="selected.size > 0"
          type="button"
          class="btn btn-danger"
          :disabled="deleting"
          @click="deleteSelected"
        >
          {{ deleting ? 'Deleting…' : `Delete ${selected.size}` }}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="exporting || total === 0"
          @click="exportCsv"
        >
          {{ exporting ? 'Exporting…' : 'Export CSV' }}
        </button>
      </div>
    </div>

    <p v-if="usingFallback" class="info-note info-note--warn">
      This type has no fields defined yet — add fields on the content type to
      choose the columns. Showing name and email for now.
    </p>
    <p v-if="error" class="info-error">{{ error }}</p>

    <div v-if="loading" class="info-empty">Loading…</div>
    <div v-else-if="rows.length === 0" class="info-empty">
      No submissions yet.
    </div>
    <template v-else>
      <div class="info-table-scroll">
        <table class="info-table">
          <thead>
            <tr>
              <th class="info-check">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  aria-label="Select all"
                  @change="toggleAll"
                />
              </th>
              <th v-for="c in columns" :key="c.name">{{ c.label }}</th>
              <th>Submitted</th>
              <th class="info-actions-col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.id"
              :class="{ 'is-selected': selected.has(r.id) }"
            >
              <td class="info-check">
                <input
                  type="checkbox"
                  :checked="selected.has(r.id)"
                  aria-label="Select submission"
                  @change="toggleOne(r.id)"
                />
              </td>
              <td
                v-for="c in columns"
                :key="c.name"
                class="info-cell"
                :title="cell(r, c.name)"
              >
                {{ cell(r, c.name) || '—' }}
              </td>
              <td class="info-date">{{ fmtDate(r.date) }}</td>
              <td class="info-actions-col">
                <button
                  type="button"
                  class="icon-btn icon-btn--danger"
                  title="Delete"
                  aria-label="Delete submission"
                  @click="deleteOne(r)"
                >
                  <Icon name="trash" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="total > rows.length" class="info-note">
        Showing the latest {{ rows.length }} of {{ total }}. Use Export CSV for
        all.
      </p>
    </template>
  </div>
</template>

<style scoped>
.info-table-wrap {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px;
}
.info-table-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.info-table-count {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.info-table-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.info-error {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--danger, #b91c1c);
}
.info-empty {
  padding: 28px 4px;
  text-align: center;
  font-size: 13.5px;
  color: var(--muted);
}
.info-table-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.info-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.info-table th,
.info-table td {
  text-align: left;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.info-table th {
  background: var(--surface-2, rgba(0, 0, 0, 0.02));
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
  position: sticky;
  top: 0;
}
.info-table tbody tr:last-child td {
  border-bottom: none;
}
.info-table tbody tr:hover {
  background: var(--accent-soft, rgba(0, 0, 0, 0.02));
}
.info-table tbody tr.is-selected {
  background: var(--accent-soft, rgba(0, 0, 0, 0.04));
}
.info-check {
  width: 1%;
  text-align: center;
  white-space: nowrap;
}
.info-check input {
  cursor: pointer;
}
.info-actions-col {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}
.info-cell {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.info-date {
  white-space: nowrap;
  color: var(--muted);
}
.info-note {
  margin: 10px 2px 0;
  font-size: 12px;
  color: var(--muted);
}
.info-note--warn {
  margin: 0 0 10px;
  color: var(--warning, #92400e);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
