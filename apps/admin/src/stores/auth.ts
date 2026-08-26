import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { ApiError, apiFetch } from '@/lib/api';

export type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'editor'
  | 'author'
  | 'viewer';

// Mirror of the server's ADMIN_ROLE_RANK (apps/api/src/middleware/require-role.ts).
// Higher rank ⇒ more privilege. Used for client-side nav gating only — the
// server is the source of truth for authorization.
const ROLE_RANK: Record<AdminRole, number> = {
  viewer: 1,
  author: 2,
  editor: 3,
  admin: 4,
  super_admin: 5,
};

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  tenantId: string | null;
  isProtected: boolean;
  // ISO timestamp; null until the user finishes or skips the welcome tour.
  // The dashboard auto-trigger fires only while this is null.
  tourCompletedAt: string | null;
}

interface MeResponse {
  user: AdminUser;
  expiresAt: string;
  publicWebUrl: string;
}

interface LoginResponse {
  user: AdminUser;
  expiresAt: string;
  publicWebUrl: string;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AdminUser | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  // Public-facing site URL exposed by /admin/auth/me. Drives the "View Site"
  // link in the topbar so editors can pop the live site in a new tab without
  // remembering the deployment hostname.
  const publicWebUrl = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value !== null);
  const isSuperAdmin = computed(() => user.value?.role === 'super_admin');
  const needsTour = computed(
    () => user.value !== null && user.value.tourCompletedAt === null,
  );

  // True when the current user's role rank is >= the given minimum role.
  function hasRole(min: AdminRole): boolean {
    if (!user.value) return false;
    return ROLE_RANK[user.value.role] >= ROLE_RANK[min];
  }

  async function fetchMe(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const data = await apiFetch<MeResponse>('/admin/auth/me');
      user.value = data.user;
      publicWebUrl.value = data.publicWebUrl;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        user.value = null;
        publicWebUrl.value = null;
      } else {
        error.value = e instanceof Error ? e.message : 'Failed to load session';
      }
    } finally {
      loading.value = false;
    }
  }

  async function login(email: string, password: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const data = await apiFetch<LoginResponse>('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      user.value = data.user;
      publicWebUrl.value = data.publicWebUrl;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Login failed';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function logout(): Promise<void> {
    // Clear local state SYNCHRONOUSLY before awaiting the server revoke.
    // Otherwise isAuthenticated stays true for the duration of the POST
    // and the user can click through the sidebar — the nav guard reads
    // this flag and only blocks once it flips. Server-side revoke is
    // best-effort; we don't surface errors because the UI is already
    // gated on the cleared local state.
    user.value = null;
    publicWebUrl.value = null;
    try {
      await apiFetch('/admin/auth/logout', { method: 'POST' });
    } catch {
      // ignore — local sign-out already took effect
    }
  }

  // Replace the stored user — used after Setup.vue completes bootstrap so
  // the auth guard recognises the new session without an extra round-trip.
  function setUser(next: AdminUser): void {
    user.value = next;
  }

  // Mark the welcome tour complete locally. The server call is fire-and-
  // forget at the call site; this just flips the flag the dashboard reads.
  function markTourCompleted(at: string): void {
    if (user.value) {
      user.value = { ...user.value, tourCompletedAt: at };
    }
  }

  return {
    user,
    loading,
    error,
    publicWebUrl,
    isAuthenticated,
    isSuperAdmin,
    needsTour,
    hasRole,
    fetchMe,
    login,
    logout,
    setUser,
    markTourCompleted,
  };
});
