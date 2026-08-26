<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  apiKeysApi,
  API_KEY_SCOPES,
  type ApiKey,
} from '@/api/api-keys';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const { confirm } = useConfirm();
const items = ref<ApiKey[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const formOpen = ref(false);
const newName = ref('');
const newScopes = ref<string[]>([]);
const creating = ref(false);
const createdKey = ref<string | null>(null);
const copied = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await apiKeysApi.list();
    items.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

function openForm(): void {
  newName.value = '';
  newScopes.value = [];
  error.value = null;
  formOpen.value = true;
}

function closeForm(): void {
  formOpen.value = false;
  newName.value = '';
  newScopes.value = [];
}

function toggleScope(scope: string): void {
  const i = newScopes.value.indexOf(scope);
  if (i === -1) newScopes.value.push(scope);
  else newScopes.value.splice(i, 1);
}

async function onCreate(): Promise<void> {
  if (!newName.value || newScopes.value.length === 0) {
    error.value = 'Name and at least one scope are required.';
    return;
  }
  creating.value = true;
  error.value = null;
  try {
    const res = await apiKeysApi.create({
      name: newName.value,
      scopes: [...newScopes.value],
    });
    createdKey.value = res.data.key;
    copied.value = false;
    items.value.unshift(res.data);
    closeForm();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Create failed';
  } finally {
    creating.value = false;
  }
}

async function copyKey(): Promise<void> {
  if (!createdKey.value) return;
  try {
    await navigator.clipboard.writeText(createdKey.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

async function onRevoke(k: ApiKey): Promise<void> {
  const ok = await confirm({
    title: 'Revoke API key',
    message: `Revoke "${k.name}"? Applications using it will stop working.`,
    confirmLabel: 'Revoke',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const res = await apiKeysApi.revoke(k.id);
    const idx = items.value.findIndex((x) => x.id === k.id);
    if (idx !== -1) items.value[idx] = res.data;
    toast.success('API key revoked');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Revoke failed');
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  return formatDate(iso);
}

function scopeStyle(scope: string): Record<string, string> {
  switch (scope) {
    case 'read:public':
      return { background: 'var(--success-soft)', color: 'var(--success)' };
    case 'read:admin':
      return { background: 'var(--info-soft)', color: 'var(--info)' };
    case 'write:content':
      return { background: 'var(--warning-soft)', color: 'var(--warning)' };
    default:
      return { background: 'var(--bg)', color: 'var(--muted)' };
  }
}

onMounted(load);
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">API Keys</h1>
        <p class="page-subtitle">Manage access tokens for external integrations</p>
      </div>
      <button type="button" class="btn btn-primary" @click="openForm">+ Create API Key</button>
    </header>

    <div class="card notice">
      <span class="notice-icon" aria-hidden="true">⚠️</span>
      <span>
        <strong>Security notice:</strong> API keys are shown once on creation. Store them securely —
        they can't be retrieved again. Revoke and regenerate if compromised.
      </span>
    </div>

    <div v-if="createdKey" class="card key-banner">
      <div class="key-banner-head">
        <strong>Copy your new key now — it won't be shown again.</strong>
        <button type="button" class="btn btn-ghost btn-sm" @click="createdKey = null">Dismiss</button>
      </div>
      <div class="key-row">
        <code class="key">{{ createdKey }}</code>
        <button type="button" class="btn btn-secondary btn-sm" @click="copyKey">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
      </div>
    </div>

    <form v-if="formOpen" class="card create-card" @submit.prevent="onCreate">
      <div class="create-fields">
        <div class="form-group name-group">
          <label class="form-label">Key name</label>
          <input v-model="newName" class="form-input" type="text" placeholder="e.g. Mobile app" maxlength="100" />
        </div>
        <div class="form-group">
          <label class="form-label">Scopes</label>
          <div class="scopes">
            <label v-for="s in API_KEY_SCOPES" :key="s" class="scope">
              <input type="checkbox" :checked="newScopes.includes(s)" @change="toggleScope(s)" />
              <code>{{ s }}</code>
            </label>
          </div>
        </div>
      </div>
      <div class="create-actions">
        <button type="submit" class="btn btn-primary" :disabled="creating">
          {{ creating ? 'Generating…' : 'Generate key' }}
        </button>
        <button type="button" class="btn btn-ghost" @click="closeForm">Cancel</button>
      </div>
    </form>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading" class="state-msg">Loading…</p>
    <div v-else-if="items.length === 0" class="empty-state">
      <div class="empty-title">No API keys yet</div>
    </div>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Scope</th>
            <th>Last used</th>
            <th>Created</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in items" :key="k.id" :class="{ revoked: k.revokedAt }">
            <td><div class="key-name">{{ k.name }}</div></td>
            <td>
              <div class="scope-list">
                <span v-for="s in k.scopes" :key="s" class="scope-badge" :style="scopeStyle(s)">{{ s }}</span>
              </div>
            </td>
            <td class="cell-muted">{{ timeAgo(k.lastUsedAt) }}</td>
            <td class="cell-muted">{{ formatDate(k.createdAt) }}</td>
            <td>
              <span v-if="k.revokedAt" class="badge badge-archived">Revoked</span>
              <span v-else class="badge badge-published">Active</span>
            </td>
            <td>
              <div class="actions">
                <button
                  v-if="!k.revokedAt"
                  type="button"
                  class="btn btn-danger btn-xs"
                  @click="onRevoke(k)"
                >
                  Revoke
                </button>
                <span v-else class="cell-muted">—</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--warning-soft);
  border-color: var(--warning);
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.5;
}
.notice-icon {
  flex-shrink: 0;
}

.key-banner {
  border-color: var(--accent);
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.key-banner-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.key-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.key {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  word-break: break-all;
  background: var(--bg);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
}

.create-card {
  margin-bottom: 16px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.create-fields {
  display: flex;
  gap: 24px;
  flex: 1;
  flex-wrap: wrap;
  align-items: flex-start;
}
.create-fields .form-group {
  margin-bottom: 0;
}
.name-group {
  min-width: 220px;
}
.create-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.scopes {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.scope {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.scope code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
}

.key-name {
  font-weight: 500;
}
.scope-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.scope-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.cell-muted {
  color: var(--muted);
  font-size: 12px;
}
.revoked {
  opacity: 0.55;
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
