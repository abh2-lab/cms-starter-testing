---
title: Page templates
order: 4
---

# Page templates

Pages come in two kinds, both chosen in the admin under **Pages**.

## Dynamic pages (blocks + a template)

A dynamic page's structure comes from a **page template** — an ordered list of
blocks (which can **nest**: a container or box block holds child blocks).
Templates are:

- **Code-shipped** — `TemplateMeta` objects in `packages/blocks/src/templates/*`
  (immutable, available to every install).
- **User-saved** — rows in the `page_templates` table (editable, tenant-scoped).

`GET /api/admin/page-templates` merges both. Applying a template **snapshots**
its blocks into the page row's `blocks` JSONB, so later template edits never
retroactively change an already-published page.

### Template-locked editing

Dynamic pages are **template-first and structure-locked**:

1. Creating a dynamic page requires picking a template.
2. The builder opens with that template's blocks already placed.
3. The editor can edit the **labels and data sources** each block exposes —
   but **cannot add, remove, or reorder** blocks. The structure is owned by
   the template.

This is the deliberate difference from a free-form block editor: editors fill
in templates, they don't assemble layouts. (The free-build code still exists
behind a flag for future "advanced mode".)

## Static pages (HTML + a layout)

A static page stores **raw HTML plus its own CSS** authored in the admin, plus a
selected **layout template**. The public renderer (`PageView.vue`, static
branch) injects the CSS into the page `<head>` and renders the HTML verbatim.
`<script>` tags inside the HTML do **not** execute (it's set via `innerHTML`).
This path is unchanged by the template-lock rules above.

> **"Scoped" means authored-to-be-scoped, not engine-scoped.** There is no
> per-page CSS sandbox: whatever you write is emitted into a single global
> `<style>` and applies to the **entire document** — including the theme's
> header, footer, and navigation. Keeping it contained is your job (and the AI
> assistant follows the same rule when it writes a page for you).

### Writing conflict-free CSS

Because page CSS is global, bare element/global selectors leak into the rest of
the site. Three rules keep a page self-contained:

1. **Wrap the page in one unique container class** — e.g. `.sp-<slug>`
   (`sp` = static page) — and put all the markup inside it.
2. **Prefix every CSS rule with that class.** Never style bare `body`, `html`,
   `h1`–`h6`, `a`, `p`, `img`, `*`, or theme utility classes on their own.
3. **Avoid `!important` and global resets** — they're the hardest leaks to undo.

#### Before — leaks into the whole site

```html
<style>
  body { background: #f5f5f5; }   /* repaints every page on the site */
  h1   { color: #b00; }           /* recolours theme headings everywhere */
  a    { text-decoration: underline; }
</style>
<h1>Our Mission</h1>
<p>…</p>
```

#### After — scoped under one container

```html
<style>
  .sp-our-mission { background: #f5f5f5; padding: 2rem; }
  .sp-our-mission h1 { color: #b00; }
  .sp-our-mission a  { text-decoration: underline; }
</style>
<section class="sp-our-mission">
  <h1>Our Mission</h1>
  <p>…</p>
</section>
```

Put analytics or other `<script>` in the page's **Extra `<head>`** field —
inline `<script>` in the body never runs.

## How a page renders

The public catch-all (`pages/[slug]/index.vue`) fetches
`GET /api/public/pages/<slug>` and hands it to `PageView.vue`:

- `type: 'static'` → inject CSS + `v-html` the HTML.
- `type: 'dynamic'` → walk `blocks[]`, resolve each key via the block registry,
  pass the API-resolved `fields`/`options`/`data` to the component.

See [Reading CMS data in Nuxt](?doc=nuxt-data) for the full request lifecycle.

## Add a page template (developer)

Code-shipped page templates live in `packages/blocks`:

1. New file `packages/blocks/src/templates/<key>.ts` exporting a `TemplateMeta`
   — `key`, `name`, optional `description`/`role`, and `blocks: []` where each
   entry is `{ block_key, default_fields, default_options }` plus an optional
   `children: []` to nest blocks under a container/box (the defaults seed the
   page when the template is applied).
2. Register it — add the import + a `templateRegistry` entry in
   `packages/blocks/src/registry.ts`.
3. `pnpm --filter @cms/blocks build` + restart the API; it then appears in the
   admin template chooser via `GET /api/admin/page-templates`.

Every `block_key` you list must be a real registered block (see
[Blocks](?doc=blocks)). User-saved templates need no code — editors create them
from the builder and they're stored in the `page_templates` table.

## Template roles & selection

Every code template also carries a **`role`** (`home` / `page` / `single` /
`archive` / `search` / `404`, plus reserved `header` / `footer`). Template
**selection** — which template renders for a surface — lives in one helper,
`resolveTemplate()` (`packages/blocks/src/templates/resolve-template.ts`), so
**all "by category / by type" conditions stay out of blocks and templates**. v1
ships a `single` template (the article body — see
[Post templates](?doc=post-templates)) and an `archive` template; the page
templates above keep rendering from each page's stored blocks.
