import { apiFetch } from '@/lib/api';
import type { AdminRole } from '@/stores/auth';

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  // True for the bootstrap super_admin created by the First Boot Experience.
  // Used to disable delete/role/active controls in the Users page.
  isProtected: boolean;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedUser extends AdminUserRow {
  // Returned only once, on creation.
  tempPassword: string;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  role: AdminRole;
}
export interface UpdateUserInput {
  displayName?: string;
  role?: AdminRole;
  isActive?: boolean;
}

export const ADMIN_ROLES: AdminRole[] = [
  'super_admin',
  'admin',
  'editor',
  'author',
  'viewer',
];

export const usersApi = {
  list: () => apiFetch<{ data: AdminUserRow[] }>('/admin/users'),
  create: (input: CreateUserInput) =>
    apiFetch<{ data: CreatedUser }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateUserInput) =>
    apiFetch<{ data: AdminUserRow }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  resetPassword: (id: string) =>
    apiFetch<{ data: { id: string; tempPassword: string } }>(
      `/admin/users/${id}/reset-password`,
      { method: 'POST' },
    ),
  remove: (id: string) =>
    apiFetch<void>(`/admin/users/${id}`, { method: 'DELETE' }),
};
