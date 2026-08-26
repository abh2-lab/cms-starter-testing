import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Node-environment vitest for the admin. The only tests are pure guards (the
// router/destinations drift check) — no DOM or Vue runtime needed, so we avoid
// pulling in jsdom. The router test swaps createWebHistory -> createMemoryHistory
// so the router builds in node. The `@` alias mirrors vite.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
