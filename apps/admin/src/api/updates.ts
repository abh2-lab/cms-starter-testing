import { apiFetch } from '@/lib/api';

// Update status for this install. Read-only plus a manual re-check — applying
// an update is a separate operator action (a container cannot rebuild itself).
// See docs/phase-3-versioning-and-updates-plan.md.

/** 'schema' releases run database migrations, so they need a backup first. */
export type ReleaseType = 'code' | 'schema';

export interface AvailableRelease {
  version: string;
  type: ReleaseType;
  releasedAt: string | null;
  notesUrl: string | null;
  /** Set when the release refuses a direct jump from the current version. */
  minUpgradeFrom: string | null;
  requiresBackup: boolean;
  /** Env vars that must be set BEFORE the new version boots, or it exits. */
  newEnvVars: string[];
}

export interface UpdateCheckState {
  /** Null = a check has never completed on this install. */
  checkedAt: string | null;
  /** Last failure. Distinguishes "no update" from "could not look". */
  error: string | null;
  enabled: boolean;
  /** True when UPDATE_CHECK_ENABLED=false pins it off — the toggle is inert. */
  lockedByEnv: boolean;
  manifestUrl: string;
}

export interface UpdateStatus {
  currentVersion: string;
  /** Built without the CMS_VERSION build arg — shown as "dev". */
  isDevBuild: boolean;
  updateAvailable: boolean;
  latest: AvailableRelease | null;
  check: UpdateCheckState;
}

export const updatesApi = {
  get: () => apiFetch<{ data: UpdateStatus }>('/admin/updates'),
  /**
   * Queues a check on the worker (202 Accepted) — it does not return the
   * result. Callers poll `get()` after a short delay.
   */
  checkNow: () =>
    apiFetch<{ data: { queued: boolean } }>('/admin/updates/check', {
      method: 'POST',
    }),
  setCheckEnabled: (checkEnabled: boolean) =>
    apiFetch<{ data: { checkEnabled: boolean } }>('/admin/updates', {
      method: 'PATCH',
      body: JSON.stringify({ checkEnabled }),
    }),
};
