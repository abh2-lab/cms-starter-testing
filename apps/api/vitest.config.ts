import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // setupFiles run BEFORE any test module loads, so env-var injection here
    // beats @cms/config's import-time validation. See vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
  },
});
