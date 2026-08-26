import { defineConfig } from 'vitest/config';

// Integration tests: spin up against the real local services from
// docker-compose (Postgres, Dragonfly, Meilisearch, MinIO). Sequential because
// Meili index state, MinIO bucket state, and BullMQ queue state are all shared.
//
// Vitest 4 moved poolOptions to top-level — `forks: { singleFork: true }` is
// expressed as just `forks: { singleFork: true }` under `test`.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./test/integration-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    pool: 'forks',
    forks: {
      singleFork: true,
    },
  },
});
