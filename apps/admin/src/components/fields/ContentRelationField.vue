<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { contentApi, type Content } from '@/api/content';
import ContentPickerModal from '../ContentPickerModal.vue';

const props = defineProps<{
  modelValue: unknown;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const pickerOpen = ref(false);
const titles = ref<Map<string, string>>(new Map());
const missing = ref<Set<string>>(new Set());

const ids = computed<string[]>(() =>
  Array.isArray(props.modelValue)
    ? props.modelValue.filter((x): x is string => typeof x === 'string')
    : [],
);

async function hydrate(): Promise<void> {
  const need = ids.value.filter(
    (id) => !titles.value.has(id) && !missing.value.has(id),
  );
  await Promise.all(
    need.map(async (id) => {
      try {
        const { data } = await contentApi.get(id);
        titles.value.set(id, data.title);
        titles.value = new Map(titles.value);
      } catch {
        missing.value.add(id);
      }
    }),
  );
}

watch(ids, hydrate);
onMounted(hydrate);

function onSelect(chosen: Content[]): void {
  for (const c of chosen) titles.value.set(c.id, c.title);
  titles.value = new Map(titles.value);
  const merged = [...ids.value];
  for (const c of chosen) if (!merged.includes(c.id)) merged.push(c.id);
  emit('update:modelValue', merged);
  pickerOpen.value = false;
}

function removeAt(id: string): void {
  emit('update:modelValue', ids.value.filter((x) => x !== id));
}
</script>

<template>
  <div class="relation-field">
    <ul v-if="ids.length > 0" class="chips">
      <li v-for="id in ids" :key="id" class="chip">
        <span class="chip-label">
          {{ titles.get(id) ?? (missing.has(id) ? 'Missing content' : 'Loading…') }}
        </span>
        <button type="button" class="remove" aria-label="Remove" title="Remove" @click="removeAt(id)"><Icon name="x" :size="12" /></button>
      </li>
    </ul>

    <button type="button" class="btn btn--small" @click="pickerOpen = true">
      Add content
    </button>

    <ContentPickerModal
      v-if="pickerOpen"
      :selected-ids="ids"
      @select="onSelect"
      @close="pickerOpen = false"
    />
  </div>
</template>

<style scoped>
.relation-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}
.chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.chip {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.8125rem;
}
.chip-label {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remove {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.75rem;
}
.remove:hover {
  color: #dc2626;
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
