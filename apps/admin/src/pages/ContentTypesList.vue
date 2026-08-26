<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError } from '@/lib/api';
import { contentTypesApi, type ContentType } from '@/api/content-types';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { confirm } = useConfirm();
const items = ref<ContentType[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const ICON_BGS = [
  'var(--info-soft)',
  'var(--purple-soft)',
  'var(--warning-soft)',
  'var(--danger-soft)',
  'var(--success-soft)',
];
function bgFor(i: number): string {
  return ICON_BGS[i % ICON_BGS.length] ?? 'var(--info-soft)';
}
function iconFor(t: ContentType): string {
  return t.icon?.trim() || '📦';
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await contentTypesApi.list();
    items.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function onDelete(item: ContentType): Promise<void> {
  if (item.isSystem) return;
  const ok = await confirm({
    title: 'Delete content type',
    message: `Delete content type "${item.name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await contentTypesApi.remove(item.id);
    items.value = items.value.filter((x) => x.id !== item.id);
    toast.success('Content type deleted');
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      toast.error('Cannot delete: content rows reference this type.');
    } else {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Content Types</h1>
        <p class="page-subtitle">Define the structure of your content</p>
      </div>
      <RouterLink :to="{ name: 'content-type-new' }" class="btn btn-primary">
        <Icon name="plus" :size="14" /> New Content Type
      </RouterLink>
    </header>

    <p v-if="loading" class="state-msg">Loading…</p>
    <p v-else-if="error" class="state-msg error">{{ error }}</p>

    <div v-else class="ct-grid">
      <div v-for="(item, i) in items" :key="item.id" class="ct-card">
        <div class="ct-card-head">
          <div class="ct-icon" :style="{ background: bgFor(i) }">
            {{ iconFor(item) }}
          </div>
          <div class="ct-actions">
            <RouterLink
              :to="{ name: 'content-type-edit', params: { id: item.id } }"
              class="ct-action"
              title="Edit"
              aria-label="Edit"
            >
              <Icon name="edit" :size="15" />
            </RouterLink>
            <button
              v-if="!item.isSystem"
              type="button"
              class="ct-action ct-action--danger"
              title="Delete"
              aria-label="Delete"
              @click="onDelete(item)"
            >
              <Icon name="trash" :size="15" />
            </button>
          </div>
        </div>

        <RouterLink
          :to="{ name: 'content-type-edit', params: { id: item.id } }"
          class="ct-name-link"
        >
          <div class="ct-name">{{ item.name }}</div>
        </RouterLink>
        <div class="ct-slug">{{ item.slug }}</div>

        <div class="ct-stats">
          <div>
            <div class="ct-stat-value">
              {{ item.fieldDefinitions.fields.length }}
            </div>
            <div class="ct-stat-label">Fields</div>
          </div>
          <div>
            <div class="ct-stat-value">{{ item.isSystem ? 'System' : 'Tenant' }}</div>
            <div class="ct-stat-label">Scope</div>
          </div>
          <div>
            <div class="ct-stat-value">{{ shortDate(item.updatedAt) }}</div>
            <div class="ct-stat-label">Modified</div>
          </div>
        </div>
      </div>

      <RouterLink
        :to="{ name: 'content-type-new' }"
        class="ct-card ct-card--new"
      >
        <Icon name="plus" :size="26" />
        <span>Create New Type</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.state-msg {
  color: var(--muted);
  font-size: 0.9rem;
}
.state-msg.error {
  color: var(--danger);
}
.ct-actions {
  display: flex;
  gap: 4px;
}
.ct-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  text-decoration: none;
  transition:
    border-color 0.15s,
    color 0.15s,
    background 0.15s;
}
.ct-action:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.ct-action--danger:hover {
  border-color: var(--danger);
  color: var(--danger);
  background: var(--danger-soft);
}
.ct-name-link {
  text-decoration: none;
  color: inherit;
}
.ct-name-link:hover .ct-name {
  color: var(--accent-hover);
}
</style>
