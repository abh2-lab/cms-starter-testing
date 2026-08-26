// Pure guard helpers for redirect create/update. Deliberately free of DB/config
// imports so they stay trivially unit-testable.

function normalizePath(p: string): string {
  // Treat /a and /a/ as the same path (but keep root "/").
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/** True when a redirect's source and target resolve to the same path. */
export function isSelfRedirect(fromPath: string, toPath: string): boolean {
  return normalizePath(fromPath) === normalizePath(toPath);
}
