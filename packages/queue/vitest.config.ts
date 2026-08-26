import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // tsc -p tsconfig.json emits compiled .test.js files into dist/ which
    // vitest would otherwise pick up alongside the source .test.ts files,
    // running every test twice. Exclude dist/ so source is the only truth.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
