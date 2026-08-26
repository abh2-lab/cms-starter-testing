// Postgres error code 42P01: "undefined_table". Surfaces when code expects a
// table that hasn't been migrated yet — typically right after a pull that
// added new schema, before the operator runs `drizzle-kit migrate`. Catching
// THIS specific code lets resolvers degrade gracefully (fall back to env
// defaults + warn) instead of crashing the boot, so the upgrade dance is
// `pull → restart (warns) → migrate → restart (silent)` rather than
// `pull → restart (crash) → migrate → restart (works)`.
//
// We deliberately only catch 42P01 — any other Postgres error is a real
// problem that should surface as a real failure.

// Module-scoped: warn at most once per table per process. The set resets
// when the process restarts, so re-warning after a restart is fine.
const warnedTables = new Set<string>();

/**
 * True when `err` is a Postgres "table does not exist" error (code 42P01)
 * for the given table. Logs a one-shot warning the first time a given table
 * triggers, pointing the operator at the migrate command.
 */
export function isUndefinedTableError(
  err: unknown,
  tableName: string,
): boolean {
  if (typeof err !== 'object' || err === null) return false;
  // Drizzle wraps postgres-js errors in DrizzleQueryError with `cause`.
  // Direct postgres-js errors have `code` on themselves. Walk both.
  const direct = (err as { code?: unknown }).code;
  const cause = (err as { cause?: unknown }).cause;
  const causeCode =
    cause && typeof cause === 'object'
      ? (cause as { code?: unknown }).code
      : undefined;
  const code = direct ?? causeCode;
  if (code !== '42P01') return false;
  if (!warnedTables.has(tableName)) {
    warnedTables.add(tableName);
    console.warn(
      `[@cms/db] table "${tableName}" does not exist — falling back to env defaults. ` +
        'Run `pnpm --filter @cms/db db:migrate` to apply pending migrations.',
    );
  }
  return true;
}
