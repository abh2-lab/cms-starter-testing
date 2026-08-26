// @cms/config validates env at import time. Inject placeholder values before
// any test module loads so transitive imports don't fail. Mirrors the
// pattern in apps/api/vitest.setup.ts. Tests that actually connect to a
// backing service must mock the relevant client.
process.env['DATABASE_URL'] ??=
  'postgres://test:test@localhost:5432/test_unused';
process.env['REDIS_URL'] ??= 'redis://localhost:6379';
process.env['MEILI_HOST'] ??= 'http://localhost:7700';
process.env['NODE_ENV'] ??= 'test';
