<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { computed, onMounted, ref } from 'vue';
import { ApiError } from '@/lib/api';
import { useAuthStore, type AdminRole } from '@/stores/auth';
import { usersApi, ADMIN_ROLES, type AdminUserRow } from '@/api/users';
import { toast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';

const auth = useAuthStore();
const { confirm } = useConfirm();

const items = ref<AdminUserRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// Invite panel
const inviteOpen = ref(false);
const newEmail = ref('');
const newName = ref('');
const newRole = ref<AdminRole>('author');
const creating = ref(false);
const credential = ref<{ email: string; tempPassword: string } | null>(null);

// Filters
const search = ref('');
const filterRole = ref<AdminRole | ''>('');
const filterStatus = ref<'' | 'active' | 'inactive'>('');

const editingRoleId = ref<string | null>(null);

const visibleUsers = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter((u) => {
    if (filterRole.value && u.role !== filterRole.value) return false;
    if (filterStatus.value === 'active' && !u.isActive) return false;
    if (filterStatus.value === 'inactive' && u.isActive) return false;
    if (
      q &&
      !u.displayName.toLowerCase().includes(q) &&
      !u.email.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
});

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((s) => (s[0] ?? '').toUpperCase()).join('') || '?';
}
function roleLabel(r: string): string {
  return r.replace(/_/g, ' ');
}
const ROLE_AVATAR: Record<AdminRole, { bg: string; color: string }> = {
  super_admin: { bg: 'var(--accent-soft)', color: 'var(--accent-hover)' },
  admin: { bg: 'var(--info-soft)', color: 'var(--info)' },
  editor: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  author: { bg: 'var(--success-soft)', color: 'var(--success)' },
  viewer: { bg: 'var(--surface-2)', color: 'var(--muted)' },
};
function avatarStyle(r: AdminRole): { background: string; color: string } {
  const v = ROLE_AVATAR[r] ?? ROLE_AVATAR.viewer;
  return { background: v.bg, color: v.color };
}
function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}
function isSelf(u: AdminUserRow): boolean {
  return auth.user?.id === u.id;
}
function isProtected(u: AdminUserRow): boolean {
  return u.isProtected === true;
}
// Single tooltip used wherever a control is locked for the bootstrap super
// admin. The API enforces the same rules — disabling here is a UX hint, not
// the security boundary.
const PROTECTED_TOOLTIP =
  "This is the bootstrap super admin and can't be changed. The system needs at least one working super admin.";

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await usersApi.list();
    items.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (!newEmail.value || !newName.value) return;
  creating.value = true;
  error.value = null;
  try {
    const { data } = await usersApi.create({
      email: newEmail.value,
      displayName: newName.value,
      role: newRole.value,
    });
    credential.value = { email: data.email, tempPassword: data.tempPassword };
    items.value.unshift(data);
    newEmail.value = '';
    newName.value = '';
    newRole.value = 'author';
    inviteOpen.value = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      error.value = 'An account with this email already exists.';
    } else {
      error.value = e instanceof Error ? e.message : 'Create failed';
    }
  } finally {
    creating.value = false;
  }
}

function toggleRoleEdit(u: AdminUserRow): void {
  editingRoleId.value = editingRoleId.value === u.id ? null : u.id;
}
async function onChangeRole(u: AdminUserRow, role: AdminRole): Promise<void> {
  editingRoleId.value = null;
  if (role === u.role) return;
  try {
    const { data } = await usersApi.update(u.id, { role });
    const idx = items.value.findIndex((x) => x.id === u.id);
    if (idx !== -1) items.value[idx] = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Update failed';
  }
}
async function onToggleActive(u: AdminUserRow): Promise<void> {
  try {
    const { data } = await usersApi.update(u.id, { isActive: !u.isActive });
    const idx = items.value.findIndex((x) => x.id === u.id);
    if (idx !== -1) items.value[idx] = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Update failed';
  }
}
async function onReset(u: AdminUserRow): Promise<void> {
  const ok = await confirm({
    title: 'Reset password',
    message: `Reset password for ${u.email}? Their current password will stop working.`,
    confirmLabel: 'Reset password',
  });
  if (!ok) return;
  try {
    const { data } = await usersApi.resetPassword(u.id);
    credential.value = { email: u.email, tempPassword: data.tempPassword };
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Reset failed');
  }
}

async function onDelete(u: AdminUserRow): Promise<void> {
  const ok = await confirm({
    title: 'Delete user',
    message: `Permanently delete ${u.email}? They will lose access immediately. This cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await usersApi.remove(u.id);
    items.value = items.value.filter((x) => x.id !== u.id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      toast.error(
        typeof (e.body as { message?: string })?.message === 'string'
          ? (e.body as { message: string }).message
          : 'This account cannot be deleted.',
      );
      return;
    }
    toast.error(e instanceof Error ? e.message : 'Delete failed');
  }
}

// Static role → permission matrix (reference only).
const PERM_ROLES: AdminRole[] = [
  'viewer',
  'author',
  'editor',
  'admin',
  'super_admin',
];
const PERMISSIONS: { name: string; allow: Record<AdminRole, boolean> }[] = [
  {
    name: 'Read published content',
    allow: { viewer: true, author: true, editor: true, admin: true, super_admin: true },
  },
  {
    name: 'Create own posts',
    allow: { viewer: false, author: true, editor: true, admin: true, super_admin: true },
  },
  {
    name: 'Edit any post',
    allow: { viewer: false, author: false, editor: true, admin: true, super_admin: true },
  },
  {
    name: 'Approve & publish',
    allow: { viewer: false, author: false, editor: true, admin: true, super_admin: true },
  },
  {
    name: 'Manage content types',
    allow: { viewer: false, author: false, editor: false, admin: true, super_admin: true },
  },
  {
    name: 'Manage users & settings',
    allow: { viewer: false, author: false, editor: false, admin: false, super_admin: true },
  },
];

onMounted(load);
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">Users &amp; Roles</h1>
        <p class="page-subtitle">{{ items.length }} users across all roles</p>
      </div>
      <button type="button" class="btn btn-primary" @click="inviteOpen = !inviteOpen">
        <Icon name="plus" :size="14" /> Invite User
      </button>
    </header>

    <div v-if="credential" class="cred-banner">
      <div>
        <strong>Temporary password for {{ credential.email }}</strong> — share it
        securely; it won't be shown again.
      </div>
      <code class="cred">{{ credential.tempPassword }}</code>
      <button type="button" class="btn btn-ghost btn-sm" @click="credential = null">
        Dismiss
      </button>
    </div>

    <div v-if="inviteOpen" class="card invite-card">
      <div class="card-title tight">Invite a user</div>
      <form class="invite-form" @submit.prevent="onCreate">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input v-model="newEmail" type="email" class="form-input" placeholder="email@example.com" />
        </div>
        <div class="form-group">
          <label class="form-label">Display name</label>
          <input v-model="newName" type="text" class="form-input" maxlength="200" />
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select v-model="newRole" class="form-select">
            <option v-for="r in ADMIN_ROLES" :key="r" :value="r">{{ roleLabel(r) }}</option>
          </select>
        </div>
        <div class="invite-actions">
          <button type="submit" class="btn btn-primary" :disabled="creating">
            {{ creating ? 'Creating…' : 'Send invite' }}
          </button>
          <button type="button" class="btn btn-ghost" @click="inviteOpen = false">Cancel</button>
        </div>
      </form>
    </div>

    <p v-if="error" class="state-msg error">{{ error }}</p>

    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="filter-bar">
          <label class="search-input">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input v-model="search" type="search" placeholder="Search users…" />
          </label>
          <select v-model="filterRole" class="select-filter">
            <option value="">All roles</option>
            <option v-for="r in ADMIN_ROLES" :key="r" :value="r">{{ roleLabel(r) }}</option>
          </select>
          <select v-model="filterStatus" class="select-filter">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <p v-if="loading" class="state-msg pad">Loading…</p>
      <p v-else-if="visibleUsers.length === 0" class="state-msg pad">No users match.</p>

      <table v-else class="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last login</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in visibleUsers" :key="u.id" :class="{ inactive: !u.isActive }">
            <td>
              <div class="user-cell">
                <span class="avatar" :style="avatarStyle(u.role)">{{ initials(u.displayName) }}</span>
                <div class="user-meta">
                  <div class="user-name">
                    {{ u.displayName }}
                    <span
                      v-if="isProtected(u)"
                      class="protected-pill"
                      :title="PROTECTED_TOOLTIP"
                    >Protected</span>
                  </div>
                  <div class="user-email">{{ u.email }}</div>
                </div>
              </div>
            </td>
            <td>
              <select
                v-if="editingRoleId === u.id && !isProtected(u)"
                class="role-select"
                :value="u.role"
                @change="onChangeRole(u, ($event.target as HTMLSelectElement).value as AdminRole)"
              >
                <option v-for="r in ADMIN_ROLES" :key="r" :value="r">{{ roleLabel(r) }}</option>
              </select>
              <span v-else class="badge" :class="`badge-${u.role}`">{{ roleLabel(u.role) }}</span>
            </td>
            <td>
              <span class="badge" :class="u.isActive ? 'badge-published' : 'badge-archived'">
                {{ u.isActive ? 'Active' : 'Inactive' }}
              </span>
            </td>
            <td class="mono cell-muted">{{ formatDate(u.lastLoginAt) }}</td>
            <td class="mono cell-muted">{{ formatDate(u.createdAt) }}</td>
            <td>
              <div class="actions">
                <button
                  v-if="!isSelf(u)"
                  type="button"
                  class="icon-btn"
                  :class="{ active: editingRoleId === u.id }"
                  :disabled="isProtected(u)"
                  :title="isProtected(u) ? PROTECTED_TOOLTIP : 'Change role'"
                  aria-label="Change role"
                  @click="toggleRoleEdit(u)"
                >
                  <Icon name="edit" />
                </button>
                <button
                  v-if="!isSelf(u)"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="isProtected(u)"
                  :title="isProtected(u) ? PROTECTED_TOOLTIP : ''"
                  @click="onToggleActive(u)"
                >
                  {{ u.isActive ? 'Deactivate' : 'Activate' }}
                </button>
                <button type="button" class="btn btn-ghost btn-sm" @click="onReset(u)">
                  Reset
                </button>
                <button
                  v-if="!isSelf(u)"
                  type="button"
                  class="btn btn-ghost btn-sm btn-danger-text"
                  :disabled="isProtected(u)"
                  :title="isProtected(u) ? PROTECTED_TOOLTIP : ''"
                  @click="onDelete(u)"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Role Permissions Reference -->
    <div class="card perm-card">
      <div class="card-title tight">Role Permissions Reference</div>
      <table class="perm-table">
        <thead>
          <tr>
            <th>Permission</th>
            <th v-for="r in PERM_ROLES" :key="r">{{ roleLabel(r) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in PERMISSIONS" :key="p.name">
            <td class="perm-name">{{ p.name }}</td>
            <td v-for="r in PERM_ROLES" :key="r" class="perm-cell">
              <Icon v-if="p.allow[r]" name="check" :size="15" class="yes" />
              <span v-else class="no">—</span>
            </td>
          </tr>
        </tbody>
      </table>
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
  margin-bottom: 12px;
}
.state-msg.pad {
  padding: 24px 20px;
}

.cred-banner {
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  font-size: 13px;
}
.cred {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  background: var(--surface);
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
}

.invite-card {
  margin-bottom: 16px;
}
.tight {
  margin-bottom: 14px;
}
.invite-form {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 12px;
  align-items: end;
}
.invite-form .form-group {
  margin-bottom: 0;
}
.invite-actions {
  display: flex;
  gap: 8px;
}
@media (max-width: 720px) {
  .invite-form {
    grid-template-columns: 1fr;
  }
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.user-name {
  font-weight: 500;
  color: var(--fg);
}
.user-email {
  font-size: 11px;
  color: var(--text-tertiary);
}
.cell-muted {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.role-select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg);
  font-family: inherit;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}
.icon-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
tr.inactive .user-cell {
  opacity: 0.6;
}

.protected-pill {
  display: inline-block;
  margin-left: 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  vertical-align: middle;
  cursor: help;
}

.btn-danger-text {
  color: var(--danger);
}
.btn-danger-text:hover:not(:disabled) {
  background: var(--danger-soft);
}
.btn[disabled],
.icon-btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Role permissions reference */
.perm-card {
  margin-top: 16px;
}
.perm-table {
  width: 100%;
  border-collapse: collapse;
}
.perm-table th {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  text-align: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.perm-table th:first-child {
  text-align: left;
}
.perm-table td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-soft);
  text-align: center;
  font-size: 13px;
}
.perm-table tbody tr:last-child td {
  border-bottom: none;
}
.perm-name {
  text-align: left !important;
  color: var(--fg);
}
.perm-cell .yes {
  color: var(--success);
}
.perm-cell .no {
  color: var(--text-tertiary);
}
</style>
