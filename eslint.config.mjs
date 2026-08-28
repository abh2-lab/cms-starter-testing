// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores (a config object with only `ignores` sets them globally).
  {
    ignores: [
      '**/dist/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'packages/db/migrations/**', // generated SQL + meta
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      // k6 scripts run inside a Go-based JS runtime, not Node, and aren't part
      // of any tsconfig — type-aware lint would fail on them.
      'loadtest/k6/**',
      // .claude/hooks/*.js is intentionally NOT ignored (linted as CJS below).
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...pluginVue.configs['flat/recommended'],

  // Type-aware language options for TS files and <script> blocks in .vue.
  // projectService resolves each file to its nearest package tsconfig, so the
  // five isolated tsconfigs all work without a root tsconfig / project refs.
  {
    files: ['**/*.{ts,mts,cts,vue}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
  },

  // .vue: top-level parser is vue-eslint-parser, with the TS parser nested for
  // <script>. Re-asserted after the vue preset so ordering can't clobber it.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
  },

  // Environment globals.
  {
    files: [
      'apps/api/**',
      'packages/**',
      '**/*.config.{ts,mts,cts}',
      '.claude/hooks/**',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/admin/src/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // apps/web — Nuxt 4 with auto-imports. The Nuxt + Vue composition API
  // names are not part of any `globals` preset, so they get declared here.
  // Keep this list in sync with the auto-imports used in components/pages —
  // anything new shows up as `no-undef` in CI.
  {
    files: ['apps/web/**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // Vue 3 Composition API
        computed: 'readonly',
        ref: 'readonly',
        reactive: 'readonly',
        readonly: 'readonly',
        watch: 'readonly',
        watchEffect: 'readonly',
        onMounted: 'readonly',
        onUnmounted: 'readonly',
        onBeforeMount: 'readonly',
        onBeforeUnmount: 'readonly',
        nextTick: 'readonly',
        // Nuxt 4 composables (https://nuxt.com/docs/api/composables)
        useHead: 'readonly',
        useSeoMeta: 'readonly',
        useRoute: 'readonly',
        useRouter: 'readonly',
        useAsyncData: 'readonly',
        useFetch: 'readonly',
        useLazyAsyncData: 'readonly',
        useLazyFetch: 'readonly',
        useState: 'readonly',
        useRuntimeConfig: 'readonly',
        useNuxtApp: 'readonly',
        useRequestEvent: 'readonly',
        useRequestHeaders: 'readonly',
        useRequestURL: 'readonly',
        useCookie: 'readonly',
        useError: 'readonly',
        useAppConfig: 'readonly',
        createError: 'readonly',
        showError: 'readonly',
        clearError: 'readonly',
        navigateTo: 'readonly',
        abortNavigation: 'readonly',
        defineNuxtPlugin: 'readonly',
        defineNuxtRouteMiddleware: 'readonly',
        defineNuxtComponent: 'readonly',
        definePageMeta: 'readonly',
        defineEventHandler: 'readonly',
        // Nuxt's auto-imported $fetch (ofetch instance with same-origin defaults).
        $fetch: 'readonly',
      },
    },
  },

  // .claude/hooks/*.js — CommonJS Node scripts, not in any tsconfig: lint
  // without type information.
  {
    files: ['.claude/hooks/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // The flat config itself and any other .mjs tooling (e.g. scripts/).
  // Must be `**/*.mjs` — a bare `*.mjs` glob only matches the repo root, so
  // nested scripts fall through to type-aware lint and crash with
  // "rule requires type information" because they're outside every tsconfig.
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },

  // Framework-idiom relaxations (kept within the recommended tier).
  {
    files: ['**/*.vue'],
    rules: {
      // Vue handles a rejected promise from a template event handler; allow
      // `@click="asyncFn"` etc. without flagging.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Page components are intentionally single-word (Home, Login, ...).
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    // Fastify route handlers are idiomatically async regardless of inner await.
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },

  // Allow the `_foo` convention for intentionally-unused names — common in
  // destructure-and-discard (`const { secret: _secret, ...row } = data`) and
  // unused callback params.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },

  // Build-time config/scripts that live outside any tsconfig `include`
  // (drizzle.config.ts, the api seed script): lint them without type-aware
  // rules so projectService doesn't error on files it can't place in a program.
  {
    files: ['packages/db/drizzle.config.ts', 'apps/api/scripts/**'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Vitest config + setup files sit beside each package's tsconfig but aren't
  // covered by its `include`. projectService can't place them, so disable
  // type-aware rules for these specifically — they're config, not app code.
  {
    files: [
      '**/vitest.config.{ts,mts,cts}',
      '**/vitest.*.config.{ts,mts,cts}',
      '**/vitest.setup.{ts,mts,cts}',
    ],
    ...tseslint.configs.disableTypeChecked,
  },

  // Only ONE theme layer is active at a time. `nuxt prepare` generates the
  // tsconfigs under apps/web/.nuxt/ for the ACTIVE theme and the layers it
  // extends, so every OTHER layer's files belong to no TypeScript program and
  // projectService cannot place them — they fail with "was not found by the
  // project service".
  //
  // Matches every theme layer EXCEPT `default`, rather than naming them one by
  // one. `default` is the core layer that the others extend and the fallback
  // when ACTIVE_THEME is unset, so it is the only one reliably in the program.
  // Naming layers individually meant CI broke the moment a new custom theme
  // appeared — themes/ping produced 51 parsing errors this way, having been
  // fine locally where ACTIVE_THEME=ping put it in the program instead.
  //
  // Structural, not a workaround: an inactive layer is genuinely outside the
  // build. Lint it without type-aware rules rather than leave it unlinted;
  // typecheck still covers whichever layer is active.
  {
    files: ['apps/web/themes/*/**/*.{ts,vue}', 'apps/web/themes/*/*.{ts,vue}'],
    ignores: ['apps/web/themes/default/**'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Phase 2 — block import-boundary fence. Blocks are DB-free and portable: a
  // loader gets everything it needs from the `ctx` it's handed (ctx.fetchContent
  // / fetchArchive / box / archive). They may import @cms/types + zod, but NEVER
  // the DB, config, the ORM/driver, Fastify, or anything under apps/. This is the
  // runnable half of the containment fence (the diff-scope guard is the other).
  {
    files: ['packages/blocks/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@cms/db', '@cms/db/*'],
              message:
                'Blocks are DB-free — fetch via the load() ctx (ctx.fetchContent / ctx.fetchArchive), never @cms/db.',
            },
            {
              group: ['@cms/config', '@cms/config/*'],
              message: 'Blocks must not read config — they receive everything via ctx.',
            },
            {
              group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres', 'ioredis', 'fastify'],
              message: 'Blocks must not import server/runtime infrastructure (ORM, driver, Fastify).',
            },
            {
              group: [
                '**/apps/api/**',
                '**/apps/web/**',
                '**/apps/worker/**',
                '**/apps/admin/**',
              ],
              message: 'Blocks must not reach into app internals — keep them portable.',
            },
          ],
        },
      ],
    },
  },

  // Prettier LAST — turn off every formatting rule so Prettier owns layout.
  eslintConfigPrettier,
);
