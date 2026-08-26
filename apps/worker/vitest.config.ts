import { defineConfig } from 'vitest/config';

// Unit-test config. Integration tests live in src/**/*.integration.test.ts and
// run via `pnpm test:integration` against the docker-compose stack — they're
// excluded here so `pnpm test` stays hermetic and fast.
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
