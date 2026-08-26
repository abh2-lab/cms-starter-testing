import { defineConfig } from 'vitest/config';

// Pure-data drift tests (destinations vs help-content) — plain node, no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
