<script setup lang="ts" generic="TRow">
import { computed, ref, watch } from 'vue';

// Reusable data-table primitive. Encapsulates the toolbar + table + numbered
// pagination + bulk-action bar + empty state — every listing screen renders
// the same shell and supplies its own filters, cells, and bulk actions
// through slots. Cell rendering is per-column via the `cell:<key>` slot so
// consumers keep full control over the markup inside each <td>.

export interface DataTableColumn {
  /** Slot name + sort identifier. Use snake_case to align with the API sort param. */
  key: string;
  label: string;
  sortable?: boolean;
  /** Forwarded to the <th>'s style.width. Use '1%' to make a column hug. */
  width?: string;
  align?: 'left' | 'right';
}

// `resultLabel`, `emptyHint`, and `emptyIcon` intentionally have no default —
// the component branches on `!== undefined` / `v-if="emptyIcon"` to distinguish
// "absent" from "passed-as-empty-string", which a default would collapse. The
// exactOptionalPropertyTypes flag also rejects `default: undefined` for an
// optional `string` prop, so disable the lint rule here instead.
/* eslint-disable vue/require-default-prop */
const props = withDefaults(
  defineProps<{
    rows: TRow[];
    columns: DataTableColumn[];
    rowKey: (row: TRow) => string;
    /** Total matching rows across all pages — drives pagination + "Showing X–Y of Z". */
    total: number;
    loading?: boolean;
    /** Set true to render the checkbox column + bulk-bar shell. */
    selectable?: boolean;
    /** Defaults to "<total> rows" — pass your own to use your noun. */
    resultLabel?: string;
    emptyTitle?: string;
    emptyHint?: string;
    emptyIcon?: string;
    /** Label used inside the bulk bar — "<n> pages selected", "<n> articles selected", etc. */
    bulkNoun?: string;
    /** Rows-per-page choices shown in the footer selector. */
    pageSizeOptions?: number[];
  }>(),
  {
    loading: false,
    selectable: false,
    emptyTitle: 'No rows',
    bulkNoun: 'row',
    pageSizeOptions: () => [10, 25, 50, 100],
  },
);
/* eslint-enable vue/require-default-prop */

const page = defineModel<number>('page', { default: 1 });
const limit = defineModel<number>('limit', { default: 50 });
const sort = defineModel<string>('sort', { default: '' });
const dir = defineModel<'asc' | 'desc'>('dir', { default: 'desc' });
const selected = defineModel<Set<string>>('selected', {
  default: () => new Set<string>(),
});

// withDefaults supplies the array, but under exactOptionalPropertyTypes the
// template still sees the prop as possibly-undefined — normalise once here so
// the footer can read `.length` / iterate without a guard.
const sizeOptions = computed<number[]>(() => props.pageSizeOptions ?? []);

const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.total / limit.value)),
);
const rangeStart = computed(() =>
  props.rows.length === 0 ? 0 : (page.value - 1) * limit.value + 1,
);
const rangeEnd = computed(
  () => (page.value - 1) * limit.value + props.rows.length,
);

const visiblePages = computed<(number | 'ellipsis')[]>(() => {
  const last = totalPages.value;
  const cur = page.value;
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const out: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, cur - 1);
  const end = Math.min(last - 1, cur + 1);
  if (start > 2) out.push('ellipsis');
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < last - 1) out.push('ellipsis');
  out.push(last);
  return out;
});

function gotoPage(p: number): void {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
}

// Changing page size while deep in the list would land on an out-of-range
// page, so always snap back to the first page.
function onLimitChange(e: Event): void {
  const next = Number((e.target as HTMLSelectElement).value);
  if (!Number.isFinite(next) || next === limit.value) return;
  limit.value = next;
  page.value = 1;
}

function toggleSort(col: DataTableColumn): void {
  if (!col.sortable) return;
  if (sort.value === col.key) {
    dir.value = dir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sort.value = col.key;
    dir.value = 'asc';
  }
}

// Per-column inline style. The first non-checkbox column with no explicit
// width claims `width: 100%` so the title cell absorbs the slack — without
// this, a selectable table's checkbox column would inherit the global
// `td:first-child { width: 100% }` rule (intended for the title in
// non-DataTable listings) and push every real column to the right edge.
function colStyle(col: DataTableColumn, index: number): Record<string, string> {
  if (col.width) return { width: col.width };
  if (index === 0) return { width: '100%' };
  return {};
}

function sortArrow(col: DataTableColumn): string {
  if (!col.sortable) return '';
  if (sort.value !== col.key) return '↕';
  return dir.value === 'asc' ? '↑' : '↓';
}

function toggleRow(id: string, checked: boolean): void {
  const next = new Set(selected.value);
  if (checked) next.add(id);
  else next.delete(id);
  selected.value = next;
}

function toggleAll(checked: boolean): void {
  if (checked) selected.value = new Set(props.rows.map(props.rowKey));
  else selected.value = new Set();
}

function clearSelection(): void {
  selected.value = new Set();
}

const allSelected = computed(
  () =>
    props.rows.length > 0 && selected.value.size === props.rows.length,
);
const someSelected = computed(
  () =>
    selected.value.size > 0 && selected.value.size < props.rows.length,
);

// .indeterminate is a DOM property, not an HTML attribute — sync it via ref.
const headerCheckbox = ref<HTMLInputElement | null>(null);
watch(someSelected, (v) => {
  if (headerCheckbox.value) headerCheckbox.value.indeterminate = v;
});

const resolvedResultLabel = computed(() => {
  if (props.resultLabel !== undefined) return props.resultLabel;
  if (props.loading) return 'Loading…';
  return `${props.total} ${props.bulkNoun}${props.total === 1 ? '' : 's'}`;
});
</script>

<template>
  <div
    v-if="selectable && selected.size > 0"
    class="bulk-bar"
    role="region"
    aria-label="Bulk actions"
  >
    <span>
      <span class="bulk-count">{{ selected.size }}</span>
      {{ bulkNoun }}{{ selected.size === 1 ? '' : 's' }} selected
    </span>
    <div class="bulk-actions">
      <slot
        name="bulk"
        :ids="Array.from(selected)"
        :clear="clearSelection"
      />
    </div>
  </div>

  <div class="table-wrap">
    <div
      v-if="$slots['toolbar'] || $slots['toolbar-right']"
      class="table-toolbar"
    >
      <div class="filter-bar">
        <slot name="toolbar" />
      </div>
      <slot name="toolbar-right">
        <span class="result-count">{{ resolvedResultLabel }}</span>
      </slot>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th
            v-if="selectable"
            class="dt-check-col"
            :style="{ width: '32px' }"
          >
            <input
              ref="headerCheckbox"
              type="checkbox"
              :checked="allSelected"
              :disabled="rows.length === 0"
              aria-label="Select all rows"
              @change="
                (e) => toggleAll((e.target as HTMLInputElement).checked)
              "
            />
          </th>
          <th
            v-for="(col, i) in columns"
            :key="col.key"
            :class="{
              sortable: col.sortable,
              sorted: col.sortable && sort === col.key,
              'dt-align-right': col.align === 'right',
            }"
            :style="colStyle(col, i)"
            @click="toggleSort(col)"
          >
            {{ col.label }}
            <span v-if="col.sortable" class="sort-arrow">
              {{ sortArrow(col) }}
            </span>
          </th>
        </tr>
      </thead>
      <tbody v-if="rows.length > 0">
        <tr
          v-for="row in rows"
          :key="rowKey(row)"
          :class="{ selected: selected.has(rowKey(row)) }"
        >
          <td
            v-if="selectable"
            class="dt-check-col"
            :style="{ width: '32px' }"
          >
            <input
              type="checkbox"
              :checked="selected.has(rowKey(row))"
              :aria-label="`Select row ${rowKey(row)}`"
              @change="
                (e) =>
                  toggleRow(
                    rowKey(row),
                    (e.target as HTMLInputElement).checked,
                  )
              "
            />
          </td>
          <td
            v-for="col in columns"
            :key="col.key"
            :class="col.align === 'right' ? 'dt-align-right' : undefined"
          >
            <slot :name="`cell:${col.key}`" :row="row" :col="col" />
          </td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr>
          <td :colspan="selectable ? columns.length + 1 : columns.length">
            <div class="empty-state dt-empty">
              <div v-if="emptyIcon" class="dt-empty-icon">{{ emptyIcon }}</div>
              <div class="empty-title">{{ emptyTitle }}</div>
              <div v-if="emptyHint" class="dt-empty-hint">{{ emptyHint }}</div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="total > 0" class="pagination">
      <button
        type="button"
        class="page-btn arrow"
        :disabled="page === 1"
        aria-label="Previous page"
        @click="gotoPage(page - 1)"
      >
        ‹
      </button>
      <template v-for="(p, i) in visiblePages" :key="`${p}-${i}`">
        <span v-if="p === 'ellipsis'" class="page-ellipsis">…</span>
        <button
          v-else
          type="button"
          class="page-btn"
          :class="{ active: p === page }"
          @click="gotoPage(p)"
        >
          {{ p }}
        </button>
      </template>
      <button
        type="button"
        class="page-btn arrow"
        :disabled="page >= totalPages"
        aria-label="Next page"
        @click="gotoPage(page + 1)"
      >
        ›
      </button>
      <span class="page-info">
        Showing {{ rangeStart }}–{{ rangeEnd }} of {{ total }}
      </span>
      <label v-if="sizeOptions.length > 1" class="page-size">
        <span class="page-size-label">Rows</span>
        <select
          class="page-size-select"
          :value="limit"
          aria-label="Rows per page"
          @change="onLimitChange"
        >
          <option v-for="n in sizeOptions" :key="n" :value="n">
            {{ n }}
          </option>
        </select>
      </label>
    </div>
  </div>
</template>

<style scoped>
.dt-check-col {
  width: 32px;
  padding-right: 0 !important;
}
.dt-align-right {
  text-align: right;
}
.result-count {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  margin-left: auto;
}
/* Rows-per-page selector. .page-info already carries margin-left:auto, so this
   sits flush to the right of it at the far end of the pagination bar. */
.page-size {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 16px;
}
.page-size-label {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.page-size-select {
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  cursor: pointer;
}
.dt-empty {
  padding: 64px 20px;
}
.dt-empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.35;
}
.dt-empty-hint {
  font-size: 13px;
  color: var(--muted);
  margin-top: 4px;
}
/* The empty-state row should not enforce the 56px row height — its content
   sets the size. Cell padding stays so the empty card has a comfortable inset. */
.table tbody tr:has(.dt-empty) {
  height: auto;
}
.table tbody tr:has(.dt-empty) td {
  height: auto;
  padding: 0;
}

input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--fg);
  cursor: pointer;
}
</style>
