// @cms/config validates env at import time. Worker tests run with no real
// backing services; inject placeholder values before any test module loads
// so transitive imports don't fail. Same shape as apps/api/vitest.setup.ts.
process.env['DATABASE_URL'] ??=
  'postgres://test:test@localhost:5432/test_unused';
process.env['REDIS_URL'] ??= 'redis://localhost:6379';
process.env['MEILI_HOST'] ??= 'http://localhost:7700';
process.env['NODE_ENV'] ??= 'test';
