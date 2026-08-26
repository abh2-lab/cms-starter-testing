---
title: Blocks
order: 3
---

# Blocks

A **block** is one repeatable section of a dynamic page — a hero, a list of
latest stories, a stat row. Blocks are **dev-shipped**: there's no "create a
block" button. Each block is two halves wired on the same string key.

## The two halves

| Half | File | Responsibility |
| --- | --- | --- |
| **Server** | `packages/blocks/src/blocks/<key>.ts` | Metadata (label, fields, options) + a pure `load(ctx, …)` that fetches the block's data. No DB import. |
| **Render** | theme `components/blocks/Block<Name>.vue` | A Vue component receiving `fields`, `options`, `data` props. |

Both are registered on the same key:

- Server registry: `packages/blocks/src/registry.ts` (`blockRegistry`)
- Render registry: theme `composables/useBlockRegistry.ts` (`BLOCK_REGISTRY`)

The admin reads block metadata from `GET /api/admin/blocks` (which iterates the
server registry) to build the editor; the public site uses the render registry
to draw each block.

## Fields vs. options

Every block declares two schema arrays:

- **`fields`** — editor-typed *copy* (titles, eyebrows). Free text/number/etc.
- **`options`** — *data bindings* (which content type, which category, which
  story). Rendered as pickers, not free text.

The admin auto-generates the form from these via `BlockFieldsForm.vue` — one
input per field type (`short_text`, `long_text`, `number`, `boolean`, `url`,
`select`, `content_slug`, `content_type_slug`, `category_slug`, `kv_list`).

## The `load()` contract

```ts
async load(ctx, { fields, options }) {
  // ctx has fetchContent + fetchArchive (already filtered to published rows).
  const items = await ctx.fetchArchive({
    typeSlug: options.content_type ?? 'article',
    count: Number(options.count) || 4,
  });
  return { items };          // object → rendered; null → "no data" path
}
```

Return an object, or `null` for "nothing to render". The composer wraps each
`load()` in try/catch — a thrown error degrades **that** block to a placeholder
and never 500s the page.

## Where bound data comes from

| Field type | Picker source |
| --- | --- |
| `content_type_slug` | Content Types (Article, Story, …) |
| `content_slug` | Published rows under the resolved content type |
| `category_slug` | Taxonomy terms |

So an editor creates an Article under **Content**, the block's `content_slug`
binding lists it, and at render time the API calls your `load()` →
`ctx.fetchContent('article', slug)` to hydrate the `data` prop.

## Block kinds

The blocks above are **self-sufficient** — they bring their own data (a hero
fetches its story, latest-news fetches a list). v1 added three more *kinds* so an
article, an archive, or a page can be composed from smaller, reusable pieces. A
block names its kind with `meta.kind` — **optional**: absent means `standalone`,
so every existing block is unchanged.

| `meta.kind` | What it is | Examples |
| --- | --- | --- |
| `standalone` *(default)* | Brings its own data; no children. | hero, latest-news, impact-stats |
| `field` | **Style-unaware** — reads the current post from the *box* and renders one piece of it. | post-title, post-content, featured-image, published-at, post-author, archive-title |
| `container` | A styling wrapper that holds **child** blocks. | group |
| `box` | Sets the **current post** (the box) for its children. | query-loop, post |

## The box — a block's current post

A **field block** fetches nothing. It reads the *current post* from `ctx.box`
and projects one field into its `data`:

```ts
// a field block: no fetch — just read the box
load(ctx) {
  return { title: ctx.box?.content.title ?? null };
}
```

The box (`PostBox`) is either a **single post** (`kind: 'detail'` — the full row
incl. `customFields`) or a **loop item** (`kind: 'summary'` — a lean list row,
with a lazy `hydrate()` for a field that needs the full body). A field block
renders nothing when there's no box, because it always sits inside one.

The body **stays in TipTap**: `post-content` reads the body from the box and the
theme renders it through the existing `renderTiptap()` util — it does **not**
turn the article into blocks. The single-article route builds the box from the
content row; an archive sets `ctx.archive` (the term being browsed) so
`archive-title` can render the heading.

## Box blocks & nesting

A block instance can now carry a **`children`** tree, and two kinds drive it:

- **`box`** — implements `resolveBoxes(ctx, …)` and sets the box for its
  children (its `children` is the per-item template). **`post`** selects one post
  by slug (one box); **`query-loop`** pulls a list (wrapping `fetchArchive`,
  inheriting the archive term from `ctx.archive`) and the composer expands the
  child template **once per item**.
- **`container`** (`group`) — wraps its children and carries the styling (style
  lives in the container, never the style-unaware field block).

The server composer `apps/api/src/lib/compose-blocks.ts` walks the tree
recursively — running `load()` / `resolveBoxes()`, expanding loops, and
enforcing depth / loop / node / hydration caps (a breach degrades to a
placeholder leaf, never a 500). The theme renders the tree with `BlockTree.vue` +
`BlockNode.vue`; container/box components place their children via the default
`<slot/>`. Code templates (`single`, `archive`) wire these together — see
[Post templates](?doc=post-templates) and [Page templates](?doc=page-templates).

## Adding a block

Five steps — the same string key ties the two halves together. (A fuller
walkthrough with code samples + pitfalls is the in-app **"How to add blocks"**
guide, linked from the Pages screen.)

1. **Server meta + loader** — new file `packages/blocks/src/blocks/<key>.ts`
   exporting a `Block` (its `meta` plus a pure `load(ctx, …)`).
2. **Register it** — add the import + a `blockRegistry` entry in
   `packages/blocks/src/registry.ts`.
3. **Render component** — new file
   `apps/web/themes/default/app/components/blocks/Block<Name>.vue`, taking
   `fields` / `options` / `data` props (handle the `data === null` case).
4. **Register the component** — import it and add it under the **same key** in
   `apps/web/themes/default/app/composables/useBlockRegistry.ts`.
5. **Rebuild + restart** — `pnpm --filter @cms/blocks build`, then restart the
   API + admin (the web app HMRs the new component automatically).

A mismatch between `meta.key` (step 2) and the registry key (step 4) is the most
common bug — the block then shows in the admin but renders blank.

For a **field / container / box** block, also set `meta.kind` accordingly (and
give a box block a `resolveBoxes` instead of a data-fetching `load`). These
aren't previewable on their own — the block-preview route returns **422** for
non-standalone kinds, since a field block needs a box and a container needs a
parent. They're placed by a template (e.g. `single`, `archive`) or nested under a
box/container, not dropped onto a page like a standalone block.
