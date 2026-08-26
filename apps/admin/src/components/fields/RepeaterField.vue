<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed } from 'vue';
import type { SubFieldDefinition } from '@/api/content-types';

const props = defineProps<{
  subFields: SubFieldDefinition[];
  modelValue: unknown;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown[]];
}>();

type Row = Record<string, unknown>;

const rows = computed<Row[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue.filter(
        (r) => r && typeof r === 'object',
      ) as Row[])
    : [],
);

function emitRows(next: Row[]): void {
  emit('update:modelValue', next);
}

function addRow(): void {
  emitRows([...rows.value, {}]);
}

function removeRow(index: number): void {
  emitRows(rows.value.filter((_, i) => i !== index));
}

function move(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= rows.value.length) return;
  const next = [...rows.value];
  const a = next[index];
  const b = next[target];
  if (a === undefined || b === undefined) return;
  next[index] = b;
  next[target] = a;
  emitRows(next);
}

function setCell(index: number, name: string, value: unknown): void {
  emitRows(
    rows.value.map((r, i) => (i === index ? { ...r, [name]: value } : r)),
  );
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asNumberOrEmpty(v: unknown): number | string {
  return typeof v === 'number' && !Number.isNaN(v) ? v : '';
}
function asBoolean(v: unknown): boolean {
  return v === true;
}
</script>

<template>
  <div class="repeater">
    <p v-if="subFields.length === 0" class="muted">
      This repeater has no sub-fields. Add them in the content type definition.
    </p>

    <template v-else>
      <ol v-if="rows.length > 0" class="rows">
        <li v-for="(row, i) in rows" :key="i" class="row">
          <div class="row-head">
            <span class="row-num">#{{ i + 1 }}</span>
            <span class="row-tools">
              <button type="button" :disabled="i === 0" title="Move up" @click="move(i, -1)">↑</button>
              <button type="button" :disabled="i === rows.length - 1" title="Move down" @click="move(i, 1)">↓</button>
              <button type="button" class="del" title="Remove" aria-label="Remove" @click="removeRow(i)"><Icon name="x" :size="12" /></button>
            </span>
          </div>
          <div class="row-fields">
            <label v-for="sf in subFields" :key="sf.id" class="sub">
              <span class="sub-label">
                {{ sf.label }}<span v-if="sf.required" class="required">*</span>
              </span>

              <input
                v-if="sf.type === 'short_text'"
                type="text"
                :value="asString(row[sf.name])"
                @input="setCell(i, sf.name, ($event.target as HTMLInputElement).value)"
              />
              <textarea
                v-else-if="sf.type === 'long_text'"
                rows="2"
                :value="asString(row[sf.name])"
                @input="setCell(i, sf.name, ($event.target as HTMLTextAreaElement).value)"
              />
              <input
                v-else-if="sf.type === 'number'"
                type="number"
                :value="asNumberOrEmpty(row[sf.name])"
                @input="setCell(i, sf.name, ($event.target as HTMLInputElement).valueAsNumber)"
              />
              <label v-else-if="sf.type === 'boolean'" class="cb">
                <input
                  type="checkbox"
                  :checked="asBoolean(row[sf.name])"
                  @change="setCell(i, sf.name, ($event.target as HTMLInputElement).checked)"
                />
                <span>Enabled</span>
              </label>
              <input
                v-else-if="sf.type === 'date'"
                type="date"
                :value="asString(row[sf.name])"
                @input="setCell(i, sf.name, ($event.target as HTMLInputElement).value)"
              />
              <select
                v-else-if="sf.type === 'select'"
                :value="asString(row[sf.name])"
                @change="setCell(i, sf.name, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">— none —</option>
                <option v-for="opt in sf.options ?? []" :key="opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </label>
          </div>
        </li>
      </ol>
      <p v-else class="muted">No entries yet.</p>

      <button type="button" class="btn btn--small" @click="addRow">+ Add entry</button>
    </template>
  </div>
</template>

<style scoped>
.repeater {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  align-items: flex-start;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}
.row {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.row-num {
  font-size: 0.75rem;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.row-tools {
  display: flex;
  gap: 0.25rem;
}
.row-tools button {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
}
.row-tools button:disabled {
  opacity: 0.3;
  cursor: default;
}
.row-tools .del:hover {
  color: #dc2626;
  border-color: #dc2626;
}
.row-fields {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.sub {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.sub-label {
  font-size: 0.75rem;
  font-weight: 500;
}
.required {
  color: #dc2626;
}
.sub input[type='text'],
.sub input[type='number'],
.sub input[type='date'],
.sub select,
.sub textarea {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: 0.875rem;
}
.cb {
  flex-direction: row !important;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.muted {
  color: var(--muted);
  font-size: 0.8125rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.8125rem;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
