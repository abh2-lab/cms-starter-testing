---
title: Managing the theme
order: 8
---

# Managing the theme

The public site is one **active theme** — a Nuxt **layer** at
`apps/web/themes/default/`. This is the hands-on guide to working on it: where
things live, how to change the look, how to extend it, and how to run it. For
*why* it's a layer (the host/theme split, the contract), see
[The theme contract](?doc=theme-contract).

## The theme at a glance

```text
apps/web/themes/default/
├── nuxt.config.ts                 theme CSS + fonts
└── app/
    ├── assets/css/theme.css       design tokens + utility classes
    ├── layouts/default.vue        site shell: header + page + footer
    ├── pages/                     every route (home, article, archives, search…)
    ├── components/                views, cards, and site chrome (header/footer)
    │   └── blocks/                one Block*.vue per dynamic-page block
    ├── composables/               useCmsFetch (API client + types),
    │                              useBlockRegistry, usePostTemplateRegistry, …
    └── utils/                     urls (link builders), byline, tiptap render
```

Rule of thumb: **routes → `pages/`**, **markup/layout → `components/`**,
**colours/spacing tokens → `assets/css/theme.css`**, **fonts → `nuxt.config.ts`**.

## Customize the look

### Design tokens — `app/assets/css/theme.css`

The generic shell and the static-page renderer read CSS variables off `:root`:

| Token | Default | Used for |
| --- | --- | --- |
| `--bg` / `--surface` | `#ffffff` | page / card background |
| `--text` | `#111111` | primary text |
| `--muted` | `#6b7280` | secondary text |
| `--accent` / `--accent-fg` | `#2563eb` / `#fff` | buttons, links |
| `--border` | `#e5e7eb` | borders |
| `--shadow` | (subtle) | card shadow |
| `--radius-sm` / `--radius` / `--radius-lg` | `4 / 6 / 10px` | corner rounding |
| `--container` | `1100px` | max content width |
| `--transition` | `0.15s ease` | hover transitions |

Utility classes built on them: `.container`, `.btn-primary`, `.btn-outline`,
`.status-pill`, `.label-eyebrow`, and the `.cms-static-shell*` classes that style
admin-authored static pages.

> **Tokens don't reskin everything.** They cover the generic shell and the
> static-page styling only. The **Decode article, cards, and header/footer carry
> their own hard-coded brand colours** inside each component's `<style>` block
> (the red `#d34135`, near-black `#121212`, cream `#f3f0e0`). Changing `--accent`
> will **not** restyle the article page. To rebrand those surfaces, edit the
> component styles directly — start with `components/ArticleView.vue`, the chrome
> blocks (`components/blocks/BlockSiteNav.vue`, `BlockFooterColumns.vue`,
> `BlockFooterBottom.vue`), and the card components.

### Fonts — `apps/web/themes/default/nuxt.config.ts`

Fonts load from Google Fonts in the **theme's own** config (`app.head.link`):
**Instrument Sans** (body) and **Merriweather** (the serif `article-feature`
long-read variant). The theme's `css` entry (`theme.css`) is declared here too.
To swap a font: edit the `<link>` href here, the `font-family` in `theme.css`,
and — for the serif article variant — the `.article-variant-nyt` overrides in
`components/ArticleView.vue`.

### Navigation, footer & logo

The header and footer are **parts** (`header`, `footer`) composed from blocks and
mounted by `layouts/default.vue`; the dark footer **shell** (canvas + container)
stays layout chrome. The nav **links** still come from the CMS **Menus**, so
editors control navigation — and, via the theme engine, the chrome *structure* —
without touching the theme:

- **`components/blocks/BlockSiteNav.vue`** (the `site-nav` block in the `header`
  part) — reads the **`main-nav`** menu via `useCmsMenu('main-nav')`. Top-level
  items with children render as dropdowns; items without children as direct
  links. A built-in `FALLBACK_NAV` constant (Home / Events / Categories / About)
  shows **only** when no `main-nav` menu exists yet (fresh install) — edit it to
  change that default.
- **`components/blocks/BlockFooterColumns.vue`** (the `footer-columns` block in
  the `footer` part) — reads the **`footer-nav`** menu via
  `useCmsMenu('footer-nav')`: each top-level item becomes a column heading and
  its children the links. Falls back to built-in columns when the menu is absent.
  The social icons and newsletter form live here too;
  **`BlockFooterBottom.vue`** (`footer-bottom`) carries the copyright line.
- **Logo + site name** come from **Site Settings** (`settings.logoUrl`,
  `settings.siteName`), each with a `FALLBACK_LOGO` constant in the component.
- **`layouts/default.vue`** mounts the `header` part, `<slot/>`, and the `footer`
  part (inside the dark footer shell) via `BlockTree`, and shows the maintenance
  banner when `settings.maintenanceMode` is on.

> To change the navigation links, edit them in **admin → Menus** (`main-nav` /
> `footer-nav`); the `FALLBACK_*` constants only affect a fresh install with no
> menus yet. To reorder or swap the chrome bands themselves, use **Theme Settings
> → Structure editor** (see [The theme engine](?doc=theme-engine)).

## Extend the theme

New block / template / part **types** are dev-shipped (code), not an admin
action — but **customizing** the ones that ship (a template/part's structure, or
a block's site-wide defaults) *is* an admin action in the theme engine (see
[The theme engine](?doc=theme-engine)). Each new type is a *logic/metadata* half
in `packages/blocks` plus a *render* half in this theme, joined by a shared string
key. Full step-by-step recipes:

- **Add a block** (a dynamic-page section) → [Blocks](?doc=blocks), and the
  in-app "How to add blocks" guide linked from the Pages screen.
- **Add a page template** (a block arrangement) → [Page templates](?doc=page-templates).
- **Add a post template** (an article layout) → [Post templates](?doc=post-templates).

## Dev workflow

```bash
pnpm --filter @cms/web dev        # public site  → http://localhost:3001
pnpm --filter @cms/admin dev      # admin        → http://localhost:5173
pnpm --filter @cms/api dev        # API          → http://localhost:3000
```

- Editing a theme `.vue` / `.css` / page → **Nuxt HMR** applies it live; no restart.
- Changing **block / template metadata** in `packages/blocks` → that package
  compiles to `dist/`, which the **API and admin** consume. Rebuild it, then
  restart the API + admin:
  ```bash
  pnpm --filter @cms/blocks build
  ```
- After moving or renaming theme files, run `nuxt prepare` (or restart web) so
  route/type generation catches up.

## Gotchas

- **Block appears in the admin library but renders blank on the site** — the key
  in `useBlockRegistry.ts` doesn't match the block's `meta.key`. They must be
  identical; the renderer shows an "unknown block" placeholder on a mismatch.
- **A new block/template isn't in the admin** — you skipped
  `pnpm --filter @cms/blocks build` (and an API/admin restart); the admin reads
  the built `dist/`, not the source.
- **`~/` imports** in theme files resolve to *this layer's* `app/`, not the host
  — which is why the whole render layer moved together with no rewrites.
- **Static-page `<script>` never runs** — static pages render via `v-html`, so
  any injected `<script>` is inert by design.

## Multiple themes (not today)

We ship a single active theme on purpose (one publisher, one site). The layer
structure leaves the door open for multi-theme later — see the forward note in
[The theme contract](?doc=theme-contract) — but there is nothing to switch
between now.
