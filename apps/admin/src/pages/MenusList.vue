<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError } from '@/lib/api';
import { menusApi, type Menu } from '@/api/menus';
import { slugify } from '@/api/taxonomies';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { confirm } = useConfirm();
const items = ref<Menu[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const newName = ref('');
const newSlug = ref('');
const slugTouched = ref(false);
const creating = ref(false);

watch(newName, (v) => {
  if (!slugTouched.value) newSlug.value = slugify(v);
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await menusApi.list();
    items.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (!newName.value || !newSlug.value) return;
  creating.value = true;
  error.value = null;
  try {
    const res = await menusApi.create({ name: newName.value, slug: newSlug.value });
    items.value.push(res.data);
    items.value.sort((a, b) => a.name.localeCompare(b.name));
    newName.value = '';
    newSlug.value = '';
    slugTouched.value = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      error.value = 'A menu with this slug already exists.';
    } else {
      error.value = e instanceof Error ? e.message : 'Create failed';
    }
  } finally {
    creating.value = false;
  }
}

async function onDelete(m: Menu): Promise<void> {
  const ok = await confirm({
    title: 'Delete menu',
    message: `Delete menu "${m.name}" and all its items?`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await menusApi.remove(m.id);
    items.value = items.value.filter((x) => x.id !== m.id);
    toast.success('Menu deleted');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-header"><h1>Menus</h1></header>

    <form class="create" @submit.prevent="onCreate">
      <input v-model="newName" type="text" placeholder="Menu name" maxlength="100" />
      <input
        v-model="newSlug"
        type="text"
        placeholder="slug"
        maxlength="100"
        class="mono"
        @input="slugTouched = true"
      />
      <button type="submit" class="btn btn--primary" :disabled="creating">
        {{ creating ? 'Adding…' : 'Add menu' }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="items.length === 0" class="muted">No menus yet.</p>

    <div v-else class="table-wrap">
      <table class="table">
      <thead>
        <tr><th>Name</th><th>Slug</th><th>Actions</th></tr>
      </thead>
      <tbody>
        <tr v-for="m in items" :key="m.id">
          <td>
            <RouterLink :to="{ name: 'menu-edit', params: { id: m.id } }" class="row-link">
              {{ m.name }}
            </RouterLink>
          </td>
          <td class="mono muted">{{ m.slug }}</td>
          <td class="actions">
            <RouterLink
              :to="{ name: 'menu-edit', params: { id: m.id } }"
              class="icon-btn"
              title="Edit items"
              aria-label="Edit items"
            >
              <Icon name="edit" />
            </RouterLink>
            <button
              type="button"
              class="icon-btn icon-btn--danger"
              title="Delete"
              aria-label="Delete"
              @click="onDelete(m)"
            >
              <Icon name="trash" />
            </button>
          </td>
        </tr>
      </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.page-header {
  margin-bottom: 1rem;
}
.create {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
}
.create input {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  font-size: 0.875rem;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}
.table th,
.table td {
  padding: 0.625rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.table th {
  font-weight: 600;
  font-size: 0.8125rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.row-link {
  font-weight: 500;
  text-decoration: none;
  color: var(--fg);
}
.row-link:hover {
  color: var(--accent);
}
.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
.muted {
  color: var(--muted);
}
.error {
  color: #dc2626;
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--fg);
  text-decoration: none;
  font-size: 0.875rem;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.btn--small {
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
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
.btn--danger:hover {
  border-color: #dc2626;
  color: #dc2626;
}
</style>
