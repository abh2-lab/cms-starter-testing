import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The "default" theme, packaged as a Nuxt layer. The host app
// (apps/web/nuxt.config.ts) activates it via `extends: ['./themes/default']`.
//
// Everything visual lives under ./app — pages, components, layouts,
// composables (incl. the data-access wrapper useCmsFetch + url helpers), utils,
// and assets. This config carries only the theme's global stylesheet and fonts.
//
// The CSS path is resolved from THIS file's directory rather than via the `~`
// alias: a layer's `~` resolves to its own srcDir, but an absolute path is
// unambiguous regardless of where the layer sits relative to the host.
const themeDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  css: [join(themeDir, 'app/assets/css/theme.css')],
  // Nuxt's generated .nuxt/tsconfig.*.json only auto-include local layers
  // that live under layers/* — a layer in themes/ is invisible to TypeScript
  // (and so to ESLint's projectService). Register this layer's files
  // explicitly; absolute paths are fine, Nuxt relativizes them against .nuxt.
  typescript: {
    tsConfig: { include: [join(themeDir, 'app/**/*')] },
    nodeTsConfig: { include: [join(themeDir, 'nuxt.config.ts')] },
  },
  hooks: {
    // Inside a layer, `~`/`@` resolve to the LAYER's app dir at build time
    // (localLayerAliases), but the generated tsconfig maps them only to the
    // host's app dir. Can't fix via typescript.tsConfig.compilerOptions.paths
    // — Nuxt's alias loop overwrites those keys after the defu merge — so
    // append theme fallbacks here, which runs after that loop. The host dir
    // stays first: it only holds app.vue, so theme imports can't collide.
    'prepare:types'({ tsConfig }) {
      const compilerOptions = (tsConfig.compilerOptions ??= {});
      // pkg-types leaves compilerOptions.paths as `any` in this program; pin
      // the real shape so the mutation below stays type-checked.
      const paths = (compilerOptions.paths ??= {}) as Record<string, string[]>;
      for (const [alias, sub] of [
        ['~', 'app'],
        ['~/*', 'app/*'],
        ['@', 'app'],
        ['@/*', 'app/*'],
      ] as const) {
        (paths[alias] ??= []).push(join(themeDir, sub));
      }
    },
  },
  app: {
    head: {
      title: 'CMS — Default Theme',
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossorigin: '',
        },
        {
          // Figtree is the PING brand font and the ONLY web font loaded —
          // it powers every marketing page. The long-form article variant
          // (ArticleView.vue), which the PING site doesn't use, falls back to
          // the system serif (Georgia) instead of loading Merriweather.
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&display=swap',
        },
      ],
    },
  },
});
