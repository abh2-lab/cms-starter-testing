import { defineConfig } from 'vitest/config';

// Minimal, Nuxt-free vitest config: the only tests here cover pure utils (e.g.
// the raw-HTML render sanitiser), so we run them in a plain node environment
// without spinning up the Nuxt test environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['themes/**/*.test.ts'],
  },
});
