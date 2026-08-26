---
title: The theme contract
order: 2
---

# The theme contract

The public site is built as a **single active theme**, organised as a
**Nuxt Layer** at `apps/web/themes/default/`. The host app
(`apps/web/`) keeps only infrastructure; the theme owns everything visual.

## What lives where

```text
apps/web/
├── app/
│   └── app.vue               ← host entry: <NuxtLayout><NuxtPage/></NuxtLayout>
├── server/                   ← Nitro middleware + routes (redirects, robots, rss, sitemap)
├── nuxt.config.ts            ← host: API proxy, ISR routeRules, `extends` the theme
└── themes/
    └── default/              ← THE THEME (a Nuxt layer)
        ├── nuxt.config.ts          theme CSS + fonts
        └── app/
            ├── pages/              all route files
            ├── layouts/default.vue site chrome wrapper
            ├── components/         views, blocks, cards, header/footer
            ├── composables/        useCmsFetch (API client + types), useBlockRegistry, useStatusPill…
            ├── utils/              urls (URL contract), byline, tiptap render
            └── assets/css/theme.css design tokens
```

The host activates the theme with `extends: ['./themes/default']`. Nuxt merges
the layer's `pages/`, `components/`, `composables/`, etc. with the host. Because
the whole render layer — **including** the data-access wrapper (`useCmsFetch`)
and the URL helpers (`urls`) — lives together in the layer, every `~/` import
resolves within the layer and nothing needed rewriting during the move. The host
keeps only `app.vue`, the Nitro `server/` routes, and `nuxt.config.ts`.

> Multi-theme later: the shared API client + URL contract would graduate into a
> shared package consumed by every theme, so themes only own presentation.

## The template types a theme must provide

A theme is "complete" when it renders every surface the API can serve:

| Surface | Implemented by | Driven by |
| --- | --- | --- |
| **Homepage** | `pages/index.vue` (renders the `home` page's blocks) | a dynamic page |
| **Post / single template(s)** | `ArticleView.vue` resolver → template components | a content row |
| **Category / tag archives** | `CategoryArchiveView.vue`, `TagArchiveView.vue` | Taxonomies |
| **Stories archive** | `pages/stories/index.vue` | Content |
| **Search** | `pages/search.vue` | query |
| **Dynamic page (blocks)** | `PageView.vue` (dynamic branch) + block registry | a page row |
| **Static page (HTML)** | `PageView.vue` (static branch) | a page row |
| **Author profile / index** | `author/[slug].vue`, `authors/index.vue` | Content |
| **Site chrome** | `header` / `footer` parts (`parts/header.ts`, `parts/footer.ts`) → `layouts/default.vue` via `BlockTree` | Menus + Site Settings |
| **404** | `createError({ statusCode: 404 })` / theme `error.vue` | — |

The **post/single** and **archive** surfaces are now backed by declarative,
`role`-tagged templates (`packages/blocks/src/templates/single.ts`, `archive.ts`)
that a shared `resolveTemplate()` selects — the same block engine the
dynamic-page surfaces use (see [Blocks](?doc=blocks)). The `header`, `footer`,
and `article-sidebar` **parts** now render the site chrome from the part registry
(`/api/public/parts/:key`) and are customizable per-install through the theme
engine — see [The theme engine](?doc=theme-engine).

## Looking ahead: multiple themes (not built yet)

The layer structure is deliberately the groundwork for a future multi-theme
step. When/if that's needed, it becomes **additive**:

1. Add a second layer (`themes/<name>/`).
2. Store the active theme in `site_settings.extra.active_theme`.
3. Resolve `extends` from that setting; have the admin's block/template
   endpoints filter by the active theme's manifest.

No data model changes are required to *start* — only when runtime switching is
actually wanted.
