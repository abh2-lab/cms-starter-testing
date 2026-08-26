<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { contentApi, type Content } from '@/api/content';

defineProps<{
  // ids already selected — shown as checked so re-picking is idempotent.
  selectedIds: string[];
}>();

const emit = defineEmits<{
  close: [];
  select: [items: Content[]];
}>();

const query = ref('');
const results = ref<Content[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const chosen = ref<Map<string, Content>>(new Map());

let debounce: ReturnType<typeof setTimeout> | undefined;

async function search(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await contentApi.list({
      limit: 25,
      ...(query.value.trim() ? { q: query.value.trim() } : {}),
    });
    results.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Search failed';
  } finally {
    loading.value = false;
  }
}

watch(query, () => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void search(), 250);
});

function toggle(c: Content): void {
  const next = new Map(chosen.value);
  if (next.has(c.id)) next.delete(c.id);
  else next.set(c.id, c);
  chosen.value = next;
}

function confirm(): void {
  emit('select', [...chosen.value.values()]);
}

onMounted(search);
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true">
      <header class="modal-header">
        <h2>Link content</h2>
        <button type="button" class="close" aria-label="Close" @click="emit('close')">✕</button>
      </header>

      <input
        v-model="query"
        type="search"
        class="search"
        placeholder="Search by title…"
        autofocus
      />

      <p v-if="loading" class="muted">Searching…</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <p v-else-if="results.length === 0" class="muted">No matches.</p>

      <ul v-else class="results">
        <li v-for="c in results" :key="c.id">
          <label
            class="row"
            :class="{ 'row--disabled': selectedIds.includes(c.id) }"
          >
            <input
              type="checkbox"
              :checked="chosen.has(c.id) || selectedIds.includes(c.id)"
              :disabled="selectedIds.includes(c.id)"
              @change="toggle(c)"
            />
            <span class="row-main">
              <span class="row-title">{{ c.title }}</span>
              <span class="row-meta"><code>{{ c.slug }}</code> · {{ c.status }}</span>
            </span>
            <span v-if="selectedIds.includes(c.id)" class="badge">already linked</span>
          </label>
        </li>
      </ul>

      <footer class="modal-footer">
        <span class="muted">{{ chosen.size }} selected</span>
        <div class="footer-actions">
          <button type="button" class="btn" @click="emit('close')">Cancel</button>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="chosen.size === 0"
            @click="confirm"
          >
            Add selected
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 2rem;
}
.modal {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  width: 36rem;
  max-width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  overflow-y: auto;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
}
.close {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 1rem;
}
.search {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.9375rem;
}
.results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  cursor: pointer;
}
.row--disabled {
  opacity: 0.6;
  cursor: default;
}
.row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.row-title {
  font-size: 0.9375rem;
}
.row-meta {
  font-size: 0.75rem;
  color: var(--muted);
}
.badge {
  font-size: 0.6875rem;
  color: var(--muted);
}
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}
.footer-actions {
  display: flex;
  gap: 0.5rem;
}
.muted {
  color: var(--muted);
  font-size: 0.875rem;
}
.error {
  color: #dc2626;
  font-size: 0.875rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.btn--primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn--primary:hover {
  background: transparent;
  color: var(--accent);
}
.btn--primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
