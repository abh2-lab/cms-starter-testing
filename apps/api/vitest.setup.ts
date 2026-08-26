// Inject placeholder env vars before any test module loads. Several modules
// in this package transitively import @cms/config (via @cms/db, etc.),
// and @cms/config validates env at import time and throws when DATABASE_URL,
// REDIS_URL, or MEILI_HOST are missing. Unit tests run with no real backing
// services, so these values are intentionally dummy — any test that actually
// tries to TALK to one of these URLs should mock the relevant client.
//
// Using ??= so a real .env-provided value (e.g. when running tests inside
// a fully-configured shell) wins.
process.env['DATABASE_URL'] ??=
  'postgres://test:test@localhost:5432/test_unused';
process.env['REDIS_URL'] ??= 'redis://localhost:6379';
process.env['MEILI_HOST'] ??= 'http://localhost:7700';
// SESSION_SECRET is required by the config schema too if validated; set a
// throwaway value so module loads succeed.
process.env['SESSION_SECRET'] ??= 'test-session-secret-not-real';
process.env['NODE_ENV'] ??= 'test';
