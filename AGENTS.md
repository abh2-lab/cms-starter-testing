# AGENTS.md — AI theme-authoring guide

> **Read this first if you are an AI coding assistant (Claude Code, Cursor,
> Windsurf, Agent SDK, …) asked to turn a design into a working theme.** It is
> the orchestration layer for the *AI Theme-Authoring Kit*: a few `pnpm`
> commands + guardrails that let you convert a **mock HTML design → working
> theme** (blocks, templates/parts, seed fixtures) ~80–90% autonomously, with a
> developer doing final QA. No server, no MCP — just files in this repo.

This repo is a self-hosted CMS. A **theme** is built from **blocks** (small,
composable render units), assembled into **templates** (page layouts) and
**parts** (header/footer/sidebar), populated by **fixtures** (sample content).
The hard part — keeping the two halves of every block in sync — is automated
by `gen`, and checked by `verify`. Your job is the judgment: decomposition,
data binding, and visual fidelity.

---

## The loop

```
mock HTML
   │  decompose into blocks + a template/part  (your judgment)
   ▼
pnpm gen:block / pnpm gen:template            (scaffolds BOTH halves)
   │  fill in load() (server data) + the .vue markup/styles  (you)
   ▼
author fixtures → apps/api/fixtures/<name>/    (sample CPTs, taxonomies, pages)
   │
   ▼
pnpm verify:theme  ──┐  structure + content checks, machine-readable
        ▲            │  fix what it reports
        └────────────┘  loop until GREEN
   │
   ▼
pnpm dev → open the public site, compare to the mock   (preview)
   │
   ▼
★ HAND OFF TO A HUMAN for QA ★   (fidelity, runtime render, a11y/responsive)
```

**`verify:theme` green proves STRUCTURE, not pixels.** It confirms keys match,
types align, loaders don't throw, and bound slugs exist in your fixtures. It
does **not** mount the `.vue` — a component that crashes at render can still
pass. So **always preview in hybrid (`pnpm dev`) before declaring done**, and the
human QA pass is mandatory, not optional.

---

## Commands

```bash
pnpm install                 # once, to link the workspace
pnpm dev:services            # start ONLY backing services (Postgres/Redis/Meili/MinIO) in Docker
pnpm dev                     # run the apps from source — admin :5173, web :3001, api :3000

# Generate (scaffolds both halves; idempotent)
pnpm gen:block --spec my-block.json
pnpm gen:block --key author-card --kind standalone --label "Author Card" --category lead
pnpm gen:template --spec my-template.json

# Verify (the gate you loop on)
pnpm verify:theme            # structure + content; add --json for machine-readable output
pnpm verify:theme:structure  # metas, registry coherence, @cms/blocks build, typecheck, render-smoke
pnpm verify:theme:content    # fixture schema + block↔fixture binding

# Rebuild the server half after editing it (verify does this for you)
pnpm --filter @cms/blocks build

# Seed sample content into a running DB
pnpm --filter @cms/api seed:fixtures -- <name> --tenant=<slug>
```

### `gen:block` spec

A block has two halves on a shared **key** (lowercase-dashed):

| Half | File | What you edit |
| --- | --- | --- |
| Server | `packages/blocks/src/blocks/<key>.ts` | `load()` — fetch/return the data this block renders |
| Render | `apps/web/themes/default/app/components/blocks/Block<Pascal>.vue` | the markup + styles |

`gen:block` writes both, plus the entry in the theme's `useBlockRegistry.ts`.

It does **not** touch `packages/blocks/src/registry.ts` — that registry is built
from a scan of `src/blocks/`, `src/templates/` and `src/parts/` at build time,
so creating the file IS the registration. Which registry a template lands in is
derived from its own `role` field. Nothing about adding a block requires editing
a shared file, which is what keeps a core update from colliding with a
publisher's own blocks (see `docs/phase-3-versioning-and-updates-plan.md`).

Pass a JSON spec (recommended):

```jsonc
{
  "key": "author-card",          // lowercase-dashed; the shared key
  "kind": "standalone",          // standalone | field | container | box (default standalone)
  "label": "Author Card",
  "category": "lead",
  "description": "A byline card for a single author.",
  "icon": "user",                // optional; a name in the admin Icon set
  "lazy": false,                 // true → defineAsyncComponent (use for tiptap-heavy blocks)
  "fields":  [ { "key": "blurb", "label": "Blurb", "type": "short_text" } ],
  "options": [ { "key": "author_slug", "label": "Author", "type": "content_slug", "required": true } ]
}
```

**`fields` vs `options`:** `fields` are user-editable copy (titles, labels —
fully overridable per page). `options` are data-binding controls (which story,
which category). Field/option `type` is one of: `short_text`, `long_text`,
`number`, `boolean`, `url`, `select` (needs `options: [..]`), `content_slug`,
`content_type_slug`, `category_slug`, `custom_field`, `kv_list`.

**The four block kinds** (the FSE box model):

| kind | `load()` returns | `.vue` renders | reads | sets |
| --- | --- | --- | --- | --- |
| `standalone` | its own data object | the data | — | — |
| `field` | a projection of the current post | the value | `ctx.box` | — |
| `container` | `null` | `<slot/>` (children) | passes box through | — |
| `box` | `null` (+ `resolveBoxes()`) | `<slot/>` per item | — | `ctx.box` for descendants |

After `gen:block`, open the two generated files and replace the `TODO(human)`
stubs. The standalone/box `load()` stubs name unused params `_ctx`/`_args` so
they compile — rename them when you wire in the real data.

### `gen:template` spec

```jsonc
{
  "key": "home-newsroom",
  "name": "Home — newsroom",
  "role": "home",                // omit for a plain page template; header|footer|sidebar → a PART
  "blocks": [
    { "block_key": "hero",     "default_fields": { "badge": "Featured" }, "default_options": { "content_type": "article", "slug": "" } },
    { "block_key": "query-loop","default_options": { "content_type": "article", "count": 6 },
      "children": [ { "block_key": "post-card" } ] }
  ]
}
```

Every `block_key` must already exist (generate the blocks first). A `role` of
`header`/`footer`/`sidebar` makes it a **part**; a system role
(`single`/`archive`/`search`/`404`/…) scaffolds the file but leaves a
`TODO(human)` marker in `resolve-template.ts` — selection logic is the one place
conditions live, so a human wires it.

### Fixtures (sample content)

Generated templates render empty without content to bind to. Author fixtures
under `apps/api/fixtures/<name>/` (see the existing `example/`, `decode/`,
`sample-cpt/` sets for the shape — `content-types.json`, `taxonomies.json`,
`posts.json`, `pages.json`, …). `verify:theme:content` checks that every
`content_type_slug` / `category_slug` a template binds to actually exists in your
fixtures (catches "passes structure but renders blank").

---

## Hard rules

1. **Keys are lowercase-dashed and must match across server ↔ Vue.** A mismatch
   renders blank with no error. `gen` keeps them aligned; `verify` catches drift.
2. **Blocks are DB-free.** A block imports nothing from `@cms/db` or the API — it
   only uses the `ctx` it's handed (`ctx.fetchContent`, `ctx.fetchArchive`,
   `ctx.box`, `ctx.archive`). The lint fence enforces this.
3. **Rebuild the server half after editing it.** `@cms/blocks` is consumed from
   `dist`; stale `dist` = the admin/API don't see your change. `verify:theme`
   rebuilds it for you.
4. **Stay inside the theme surface.** Edit only `packages/blocks/src/{blocks,
   templates,parts}` + its registry/index, the theme's `components/blocks` +
   `useBlockRegistry.ts`, and `apps/api/fixtures`. `pnpm check:theme-scope` fails
   the diff otherwise. Do **not** touch API routes, the composer, or the DB.
5. **Never run `prettier --write`.** This repo has no Prettier config (its
   defaults fight the single-quote codebase). ESLint is the only formatter/gate.
   `gen` emits eslint-clean, single-quoted code.
6. **Field/box/container blocks aren't standalone-previewable** (the block-gallery
   preview returns 422 by design) — preview them by placing them in a template.
7. **`verify:theme` green ≠ done.** It proves structure. Preview in hybrid and let
   a human QA fidelity/runtime/a11y before shipping.

---

## Authoring ≠ runtime — do NOT author on the live site

- **Authoring happens in HYBRID/DEV** on your machine: backing services in Docker
  (`pnpm dev:services`), the apps from source (`pnpm dev`). This is where `gen`,
  `verify`, and the preview loop run.
- **Runtime is full Docker on Coolify**, with the theme **baked into the images at
  build time**. You never edit theme code on the deployed container.
- The pipeline: author in hybrid → `verify:theme` green → human QA → **commit** →
  build images (the web image build re-runs `verify:theme:structure`, so broken
  theme code can't deploy) → deploy to Coolify → seed content with the one-shot
  `docker compose run --rm api pnpm --filter @cms/api seed:fixtures -- <name> --tenant=<slug>`.

---

## Going deeper

The kit automates the recipes in the developer reference docs — read them for the
"why" behind a block, template, or the runtime override engine. In the admin app
under `apps/admin/src/docs/`:

- `03-blocks.md` — the two halves, the box model, the manual add recipe `gen` automates.
- `04-page-templates.md` — dynamic vs static pages, template roles.
- `05-post-templates.md` — single-article layout selection.
- `07-theme-engine.md` — the runtime FSE override layer admins use on top of your code.
- `08-managing-the-theme.md` — CSS tokens, fonts, the dev workflow, the gotchas.

Generated templates/parts are **override-compatible**: admins can customize them
at runtime through that engine with no code change. Set `version: 1` on new
templates (gen does); bump it later when you change a template's structure so
admins who customized it see an "update available" badge.
