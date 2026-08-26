// Version comparison for the release/update system.
// See docs/phase-3-versioning-and-updates-plan.md.
//
// Lives in @cms/config because that package already owns CMS_VERSION, and both
// the worker (which runs the manifest check) and the API (which serves the
// status to the admin) depend on it — so there is one implementation, not two
// that can drift.
//
// Strict `major.minor.patch` only. No pre-release or build metadata: the
// release rule produces plain three-part versions, and a semver dependency
// would be supply-chain surface in a product handed to other publishers.
//
// node: imports are top-level and static. @cms/config is server-only — api,
// worker, db, email, queue and search depend on it; neither the admin SPA nor
// the Nuxt web app does — so there is no bundler that has to resolve fs.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parsed triple, or null when the string isn't a strict x.y.z version. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = SEMVER_RE.exec(v.trim());
  // Destructured, not indexed: under noUncheckedIndexedAccess `m[1]` is
  // `string | undefined`, and Number(undefined) is a silent NaN.
  const [, major, minor, patch] = m ?? [];
  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }
  return [Number(major), Number(minor), Number(patch)];
}

/**
 * -1 if a < b, 0 if equal, 1 if a > b. An unparseable version sorts lowest,
 * so an unversioned dev build ('0.0.0' or garbage) always reads as behind and
 * never suppresses an update banner.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const [aMajor, aMinor, aPatch] = pa;
  const [bMajor, bMinor, bPatch] = pb;
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/** Last-resort version when package.json cannot be read at all. */
export const DEV_VERSION = '0.0.0';

/** True when this build carries no real version (local dev, or a bad build). */
export function isDevVersion(v: string): boolean {
  return v === DEV_VERSION;
}

/**
 * Read the monorepo root package.json version, or null if unreadable.
 *
 * This is the DEFAULT for CMS_VERSION, so an install reports its real version
 * even when nobody passed the build arg. Without it, a build-from-source
 * deploy (which is how Coolify runs this today) comes up as 0.0.0 and shows a
 * permanent, false "update available" banner — a silent failure that every
 * publisher would hit, because forgetting an unset env var produces no error.
 *
 * Resolved relative to THIS MODULE, never process.cwd(): in dev the API runs
 * with cwd=apps/api, which has its own package.json. From
 * packages/config/dist/version.js three levels up is the repo root, and the
 * Docker images preserve that same layout under /repo, so one path works in
 * both places.
 *
 * An explicit CMS_VERSION still wins — the release workflow sets it from the
 * git tag, which is the authoritative source once images are published.
 */
export function detectRepoVersion(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(
      resolve(here, '..', '..', '..', 'package.json'),
      'utf8',
    );
    const version: unknown = (JSON.parse(raw) as { version?: unknown }).version;
    if (typeof version !== 'string' || !parseVersion(version)) return null;
    return version;
  } catch {
    // Missing file, bad JSON, or a runtime without fs — fall back silently.
    return null;
  }
}

/**
 * The version this install IS — read from the monorepo root package.json, and
 * from nowhere else.
 *
 * There is deliberately NO environment override. There used to be a
 * CMS_VERSION env var, set through a compose build arg, and it was a pure
 * liability: compose substituted a literal '0.0.0' when the variable was
 * unset, which is a perfectly valid non-empty string, so it won every time and
 * the package.json fallback never ran. A test install reported itself as
 * version 0.0.0 and believed every release was newer than itself.
 *
 * The version and the code are the same artifact — they ship in the same image
 * — so anything that can disagree with package.json can only ever be wrong.
 * CI already fails a release whose tag does not match package.json, which
 * makes package.json authoritative for published images too.
 */
export const CMS_VERSION: string = detectRepoVersion() ?? DEV_VERSION;
