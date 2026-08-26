# Worker integration tests

End-to-end tests that exercise each BullMQ processor against the real local
services from `docker-compose.yml` (Postgres, Dragonfly, Meilisearch, MinIO).
They do **not** orchestrate the stack — bring it up first.

## One-time setup

```bash
docker compose up -d
# Create the dedicated test database. cms_test is separate from the dev cms DB
# so tests never touch dev rows.
createdb -h localhost -U postgres cms_test
```

Migrations apply automatically on the first test run.

## Running

```bash
pnpm --filter @cms/worker test:integration
```

Re-run twice in a row — the second run should pass without manual cleanup,
proving the suite leaves no dirty state.

## What's where

| Path | Purpose |
|---|---|
| `.env.test` | Loaded before any `@cms/*` import. Points at `cms_test` DB, Redis db 15, `cms-media-test` bucket. |
| `test/integration-setup.ts` | Per-file: migrate cms_test, ensure bucket, configure Meili index, `FLUSHDB` Redis db 15. |
| `test/helpers/queue.ts` | `createTestRedis`, `waitForJob(worker, jobId)`, `pollUntil(fn)`. |
| `test/helpers/db.ts` | Re-exports `db` + `schema` from `@cms/db`, plus `truncate()` and `seedBase()`. |
| `test/helpers/s3.ts` | `clearPrefix`, `putBytes`, `listKeys` against the test bucket. |
| `test/helpers/meili.ts` | `clearContentIndex`, `getContentDoc`. |
| `test/helpers/webhook-server.ts` | In-test `node:http` server on port 0 for the webhook-deliver test. |
| `src/processors/*.integration.test.ts` | The five processor tests. |

## Isolation model

- **Postgres**: `cms_test` DB; each test `TRUNCATE ... CASCADE` the tables it touches.
- **Redis**: db 15; `FLUSHDB` runs once per test file. `FLUSHALL` is a footgun (it would nuke dev queues in db 0).
- **MinIO**: `cms-media-test` bucket; each test `clearPrefix()` its own prefix.
- **Meili**: `content` index; setup `deleteAllDocuments` once per file.

Tests run sequentially (`fileParallelism: false`, `singleFork: true`) so the
shared external state never races between files.
