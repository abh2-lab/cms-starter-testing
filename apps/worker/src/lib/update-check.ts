import { db, schema } from '@cms/db';
import { compareVersions, env, parseVersion } from '@cms/config';

import type { Logger } from '../logger.js';

/**
 * Release-manifest poll — the detection half of the publisher update system.
 * See docs/phase-3-versioning-and-updates-plan.md.
 *
 * Fetches the manifest, finds the newest release this install is allowed to
 * move to, and records it on the singleton `update_status` row. It never
 * applies anything: deciding to upgrade is always an operator action.
 *
 * This lives in the worker, not the API, so there is exactly one
 * implementation. The admin's "check now" button enqueues the same job.
 *
 * Failure policy: a failed check is recorded (checkError) and swallowed. A
 * release host being down must never fail a job, retry-storm an outbound
 * endpoint, or hide the last known-good answer — the previous latest_* values
 * stay on the row so the banner keeps working offline.
 */

// ─── Manifest shape ─────────────────────────────────────────────────────────

export interface ReleaseEntry {
  version: string;
  type: 'code' | 'schema';
  released: string;
  notes_url?: string;
  min_upgrade_from?: string;
  requires_backup?: boolean;
  new_env_vars?: string[];
}

export interface UpdateCheckResult {
  skipped?: 'disabled';
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Set when the newest release refuses a direct jump from currentVersion. */
  blockedBy?: string;
  error?: string;
}

/**
 * Validate one manifest entry. Unknown fields are ignored (forward-compatible:
 * a newer manifest must not break an older install's parser), and anything
 * malformed is dropped rather than throwing — one bad entry should not blind
 * the install to every other release.
 */
function toReleaseEntry(raw: unknown): ReleaseEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  // Bracket access throughout: these keys come from an index signature, and
  // the repo runs with noPropertyAccessFromIndexSignature.
  const r = raw as Record<string, unknown>;
  const version = r['version'];
  const type = r['type'];
  if (typeof version !== 'string' || !parseVersion(version)) return null;
  if (type !== 'code' && type !== 'schema') return null;

  const released = r['released'];
  const notesUrl = r['notes_url'];
  const minFrom = r['min_upgrade_from'];
  const envVars = r['new_env_vars'];

  return {
    version: version.trim(),
    type,
    released: typeof released === 'string' ? released : '',
    ...(typeof notesUrl === 'string' ? { notes_url: notesUrl } : {}),
    ...(typeof minFrom === 'string' && parseVersion(minFrom)
      ? { min_upgrade_from: minFrom }
      : {}),
    requires_backup: r['requires_backup'] === true,
    ...(Array.isArray(envVars)
      ? {
          new_env_vars: envVars.filter(
            (x): x is string => typeof x === 'string',
          ),
        }
      : {}),
  };
}

/**
 * Accepts either a bare array of entries or `{ releases: [...] }`, so the
 * manifest can grow top-level fields later without breaking older installs.
 */
function parseManifest(body: unknown): ReleaseEntry[] {
  const list = Array.isArray(body)
    ? body
    : typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as { releases?: unknown }).releases)
      ? ((body as { releases: unknown[] }).releases)
      : null;
  if (!list) return [];
  return list
    .map(toReleaseEntry)
    .filter((e): e is ReleaseEntry => e !== null)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Pick what to advertise. Walks releases newer than `current` from oldest to
 * newest and stops at the first one this install may not jump to directly —
 * the GitLab required-upgrade-path model. An install on 1.2.0 looking at
 * [1.3.0, 1.4.0 (min_upgrade_from 1.3.0)] is offered 1.3.0, not 1.4.0.
 */
export function pickTarget(
  current: string,
  releases: ReleaseEntry[],
): { target: ReleaseEntry | null; blockedBy?: string } {
  let target: ReleaseEntry | null = null;

  for (const rel of releases) {
    if (compareVersions(rel.version, current) <= 0) continue;
    // Gate against the version the install is ACTUALLY running, never against
    // how far this walk has got. `min_upgrade_from: 1.3.0` means the box must
    // already BE on 1.3.0 — its migrations were only tested from a 1.3.0
    // database. An install on 1.2.0 cannot "pass through" 1.3.0 in one jump;
    // it has to run 1.3.0 first and apply those migrations for real.
    if (
      rel.min_upgrade_from &&
      compareVersions(current, rel.min_upgrade_from) < 0
    ) {
      // Everything from here on needs an intermediate hop. Offer the newest
      // release that is reachable now, and name the one that stopped us.
      return { target, blockedBy: rel.version };
    }
    target = rel;
  }
  return { target };
}

/**
 * Upsert the singleton row. Concurrent checks converge on one row.
 *
 * Timestamps are JS Dates rather than `sql`now()`` because the typed insert
 * shape wants Date. App clock vs DB clock is immaterial for a daily poll.
 */
async function writeStatus(
  values: Partial<typeof schema.updateStatus.$inferInsert>,
): Promise<void> {
  await db
    .insert(schema.updateStatus)
    .values({ singleton: 'singleton', ...values })
    .onConflictDoUpdate({
      target: schema.updateStatus.singleton,
      set: { ...values, updatedAt: new Date() },
    });
}

export async function runUpdateCheck(log: Logger): Promise<UpdateCheckResult> {
  const currentVersion = env.CMS_VERSION;

  // Two independent off switches: the env var (a deploy can enforce it) and
  // the DB flag (an operator can set it from the admin). Either disables.
  if (!env.UPDATE_CHECK_ENABLED) {
    log.info('update-check skipped — disabled by UPDATE_CHECK_ENABLED');
    return { skipped: 'disabled', currentVersion, latestVersion: null, updateAvailable: false };
  }
  const [existing] = await db.select().from(schema.updateStatus).limit(1);
  if (existing && !existing.checkEnabled) {
    log.info('update-check skipped — disabled in update_status');
    return { skipped: 'disabled', currentVersion, latestVersion: null, updateAvailable: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    env.UPDATE_CHECK_TIMEOUT_MS,
  );

  try {
    const res = await fetch(env.UPDATE_MANIFEST_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`manifest fetch failed: HTTP ${res.status}`);
    }
    const releases = parseManifest(await res.json());
    if (releases.length === 0) {
      throw new Error('manifest contained no valid releases');
    }

    const { target, blockedBy } = pickTarget(currentVersion, releases);

    if (!target) {
      // Up to date. Clear the advertised release so a stale banner can't
      // linger after the operator upgrades, and clear any previous error.
      await writeStatus({
        latestVersion: null,
        latestType: null,
        latestReleasedAt: null,
        latestNotesUrl: null,
        minUpgradeFrom: null,
        requiresBackup: false,
        newEnvVars: [],
        checkedAt: new Date(),
        checkError: null,
      });
      log.info({ currentVersion, blockedBy }, 'update-check: up to date');
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        // Spread rather than assign undefined — exactOptionalPropertyTypes.
        ...(blockedBy ? { blockedBy } : {}),
      };
    }

    await writeStatus({
      latestVersion: target.version,
      latestType: target.type,
      latestReleasedAt: target.released ? new Date(target.released) : null,
      latestNotesUrl: target.notes_url ?? null,
      minUpgradeFrom: target.min_upgrade_from ?? null,
      // A schema release always needs a backup, whatever the manifest says.
      requiresBackup: target.requires_backup === true || target.type === 'schema',
      newEnvVars: target.new_env_vars ?? [],
      checkedAt: new Date(),
      checkError: null,
    });

    log.info(
      { currentVersion, latestVersion: target.version, type: target.type, blockedBy },
      'update-check: update available',
    );
    return {
      currentVersion,
      latestVersion: target.version,
      updateAvailable: true,
      ...(blockedBy ? { blockedBy } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Record the failure but keep the last known-good latest_* values.
    await writeStatus({ checkedAt: new Date(), checkError: message }).catch(
      (writeErr: unknown) => {
        log.warn({ err: writeErr }, 'update-check: could not record failure');
      },
    );
    log.warn({ err, url: env.UPDATE_MANIFEST_URL }, 'update-check failed');
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}
