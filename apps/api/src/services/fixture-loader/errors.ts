// Thrown by validate.ts after collecting every fixture-level error in one pass.
// Emitting all errors at once lets a fixture author fix every mistake on the
// next run, instead of playing whack-a-mole with one ZodError at a time.
export class FixtureValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Fixture validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((m) => `  - ${m}`).join('\n'),
    );
    this.name = 'FixtureValidationError';
    this.issues = issues;
  }
}

// Tiny mutable buffer used by validate.ts to gather issues across multiple
// JSON files before deciding whether to throw. Kept as a class so a single
// instance can be threaded through every check.
export class IssueCollector {
  private readonly issues: string[] = [];

  add(file: string, path: string, message: string): void {
    this.issues.push(`${file}${path ? ` (${path})` : ''}: ${message}`);
  }

  addRaw(message: string): void {
    this.issues.push(message);
  }

  get count(): number {
    return this.issues.length;
  }

  throwIfAny(): void {
    if (this.issues.length === 0) return;
    throw new FixtureValidationError(this.issues);
  }
}
