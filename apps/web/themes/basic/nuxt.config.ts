import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The "basic" neutral starter theme, packaged as a Nuxt layer. It EXTENDS the
// default (Decode) theme and overrides only the design-heavy pieces — the site
// chrome (header/footer) and a few block renderers — with plain, neutral
// versions. Everything else (pages, composables, the block resolver, the
// generic block renderers) is inherited from the default layer, so this theme
// stays small. The host app activates it via ACTIVE_THEME=basic.
//
// A later phase can make this layer fully self-contained (copying the inherited
// theme-agnostic files in) so the Decode layer can be dropped from the starter
// bundle entirely.
const themeDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  // Inherit the default theme's pages/components/composables/utils, then let the
  // files in THIS layer override same-named ones.
  extends: [join(themeDir, '..', 'default')],
  // Loaded after the default theme's stylesheet, so these neutral tokens win.
  css: [join(themeDir, 'app/assets/css/theme.css')],
  typescript: {
    tsConfig: { include: [join(themeDir, 'app/**/*')] },
    nodeTsConfig: { include: [join(themeDir, 'nuxt.config.ts')] },
  },
  hooks: {
    // Same layer-alias fallback the default theme installs — makes `~`/`@`
    // resolve to THIS layer's app dir for any file that imports via the alias.
    'prepare:types'({ tsConfig }) {
      const compilerOptions = (tsConfig.compilerOptions ??= {});
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
      // Plain document title; no external brand fonts (the neutral theme uses a
      // system font stack). The default layer's font <link>s still merge in but
      // go unused — a later self-contained pass can drop them.
      title: 'CMS',
    },
  },
});
