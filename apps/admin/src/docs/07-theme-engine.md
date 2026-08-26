---
title: The theme engine
order: 7
---

# The theme engine

The theme ships its templates and parts as **code** (see
[The theme contract](?doc=theme-contract)). The **theme engine** lets a publisher
*customize* those code-shipped structures — and individual blocks' site-wide
defaults — from the admin, **without touching the theme**. It's an FSE-style
(full-site-editing) **override layer**: the code stays the default, and the
database stores per-tenant *replacements* that win at render time.

Editing it is an **admin** action: the Structure editor and Theme Settings are
gated to **admin + super_admin** (`requiresAdmin`), unlike most of the
config screens around them. This page is the model + the API; for the code side
(authoring templates/parts/blocks) see [Blocks](?doc=blocks),
[Page templates](?doc=page-templates), and [Post templates](?doc=post-templates).

## The override model

Code-shipped templates and parts (the `@cms/blocks` registries) are the
**defaults**. An admin's edits are stored as a per-tenant **replacement**
block-tree in the `theme_overrides` table — one row per template/part key,
carrying two trees that legitimately coexist:

| Column | Meaning |
| --- | --- |
| `draft_blocks` | the pending, unpublished edit (`null` = no draft) |
| `published_blocks` | the live override (`null` = nothing published → code default renders) |

The **one precedence rule**, applied at every composition site
(`apps/api/src/lib/theme-overrides.ts`):

```text
published render:  published_blocks ?? code default
draft preview:     draft_blocks ?? published_blocks ?? code default
```

It is **binary keep/reset** — a stored tree *replaces* the code tree wholesale,
never merges. "Customize" = store a tree; "reset" = delete the row, so the code
default renders again.

Resolution is **fail-open**: an invalid stored tree, or the `theme_overrides`
table not existing yet (migration `0023` not run), falls back to the code default
with a warning — a customization can never 500 a public page. Stored trees are
also validated + normalized (code defaults filled *under* the stored values), so
an old tree can't crash against newer code.

> Storage: `theme_overrides` + the append-only `theme_override_revisions`
> (migration `0023`, `packages/db/src/schema/theme-overrides.ts`). Each row is
> `tenant_id`-scoped and unique per `template_key`.

## What's overridable

`listThemeEntries()` enumerates every overridable template + part:

| Entry | Kind | Key | Renders |
| --- | --- | --- | --- |
| Article (single) | template | `single-article` | composes inside every content detail payload |
| Category archive | template | `archive-category` | a category listing |
| Tag archive | template | `archive-tag` | a tag listing |
| Default archive | template | `archive-default` | the archive fallback |
| Search | template | `template-search` | `/search` |
| 404 | template | `template-404` | the error page |
| Authors | template | `template-authors` | `/authors` |
| Contact | template | `template-contact` | `/contact` |
| Header | part | `header` | site header (mounted by `layouts/default.vue`) |
| Footer | part | `footer` | site footer (mounted by `layouts/default.vue`) |
| Article sidebar | part | `article-sidebar` | the article right rail |

**`home` and `page` are *not* overridable.** Those render from each page row's
own stored block snapshot (seeded from a template at page-creation — see
[Page templates](?doc=page-templates)), not from a render-time template, so the
override layer doesn't apply to them.

> The `single` entry overrides the **template** key (`single-article`) — the
> article *body* structure — not the post-template *variant*
> (`article-standard` / `article-feature`), which only switches `ArticleView`'s
> CSS layout (see [Post templates](?doc=post-templates)).

## The admin surfaces

| Surface | Route | What it is |
| --- | --- | --- |
| **Theme Settings** | `/theme-settings` | The hub. Four cards: **Active Theme** (read-only identity), **Templates & Parts** (the override list with a status chip + View / Edit / Reset per row), **Page Templates** (the dynamic editor's reusable layouts), **Theme & System Routes** (the code route manifest). |
| **Structure editor** | `/structure/:key` | Full-screen `BlocksEditor` in `mode="theme"` — edits one template/part's **draft** tree with a live iframe preview of a representative page. |
| **Block Gallery** | `/block-gallery` | Visual catalogue of every block; an "Edit" opens the block-defaults editor. |
| **Block defaults** | `/blocks/:key/edit` | Edits one block's **site-wide default** fields (copy) + options (sources). |

All four are **admin + super_admin** and sit under the admin's **Structure** nav
group. Each Templates & Parts row shows one status chip:

| Chip | State |
| --- | --- |
| **Default** | no override row — pure code default |
| **Customized** | a published override is live |
| **Draft** | an unpublished draft exists |
| **Update available** | the code template moved past the override's `base_version` (see below) |

(When several apply, the precedence is update-available > draft > customized > default.)

## Lifecycle: draft → publish → discard / reset

A template/part override moves through four actions; the Structure editor's
buttons map 1:1 to the API:

- **Save draft** (`PUT /overrides/:key`) — upserts `draft_blocks`. A brand-new
  row is stamped with the current code `base_version`.
- **Publish** (`POST /overrides/:key/publish`) — copies `draft_blocks` →
  `published_blocks`, clears the draft, **re-bases `base_version` to the current
  code version** (clears "update available"), snapshots a revision, and
  invalidates the affected caches (the Redis payloads + the Nuxt SWR'd HTML).
  `409 no_draft` if there's nothing to publish.
- **Discard draft** (`POST /overrides/:key/discard-draft`) — clears
  `draft_blocks`. If the row was *draft-only* (never published), the whole row is
  deleted (back to code default).
- **Reset** (`POST /overrides/:key/reset`) — deletes the row entirely → the code
  default renders immediately. (`404` if the entry wasn't customized.)

There's no "publish straight from code" — you always edit a **draft** first, then
publish it.

### Block defaults

The same lifecycle drives **per-block defaults** (`/block-defaults/:key/*`): an
admin edits a block's default fields/options once, and those values apply
**wherever that block is placed** — but *beneath* any value set on a specific
instance, so a per-page/template edit still wins. They're stored as a
`kind='block'` override row keyed `block:<blockKey>` holding a single instance,
and merged under the placed values by `applyBlockOverrides()`. Because a block
default can surface in any composed payload, publishing/resetting one clears
**all** block-render caches for the tenant. (Block defaults are **not**
revisioned.)

## Revisions & restore

Publishing a template/part snapshots the just-published state into
`theme_override_revisions` (append-only, mirroring page revisions).
`GET /overrides/:key/revisions` lists the last 20. **Restore
(`POST /overrides/:key/revisions/:n/restore`) copies a snapshot back into the
*draft* — never directly live**; you re-publish to make it live. (Draft saves are
keystroke-frequency form edits, so they aren't snapshotted.)

## `base_version` & "update available"

Each code template carries an optional `meta.version` (absent ⇒ `1`). When an
override publishes, its `base_version` is stamped to that version. The
**"Update available"** badge fires when the code has since moved on —
`codeTemplate.version > base_version` — i.e. a developer shipped a structural
change *after* the publisher customized. The override **keeps rendering** (their
published tree is still live); the badge just prompts them to open the editor,
reconcile against the new code default, and re-publish (which re-bases
`base_version`).

> So: **bump `meta.version`** on a template/part when you ship a breaking
> structural change, so customized installs are told to reconcile instead of
> silently diverging from the new code.

## The API surface

Everything lives under **`/api/admin/theme/**`** (`apps/api/src/routes/admin/theme.ts`).
Every endpoint requires an authenticated admin-panel user; all except the
read-only `/routes` manifest additionally require **rank ≥ admin**
(`requireAdminRole('admin')`).

| Method · path | Purpose |
| --- | --- |
| `GET /structure` | the overridable list + each entry's state (customized / hasDraft / updateAvailable, last-edited-by) |
| `GET /overrides/:key` | editor payload — code blocks + draft + published + flags |
| `PUT /overrides/:key` | save draft (≤ 200 top-level blocks) |
| `POST /overrides/:key/publish` | draft → published (+ revision, cache purge) |
| `POST /overrides/:key/discard-draft` | clear draft (delete row if draft-only) |
| `POST /overrides/:key/reset` | delete row → code default |
| `GET /overrides/:key/revisions` · `POST …/:n/restore` | history · restore into draft |
| `POST /overrides/:key/preview-token` · `GET …/view-url` | iframe preview URL · live "View on site" path |
| `GET·PUT /block-defaults/:key` (+ `/publish` `/discard-draft` `/reset` `/preview-token`) | per-block site-wide defaults |
| `GET /meta` · `GET /routes` | active-theme identity · code route manifest |

## For developers shipping templates & parts

The override layer sits on top of your code, and a few things follow from that:

- A template/part is a `TemplateMeta` (`key`, `role`, `name`, `blocks[]`,
  optional `version`). Templates register in `roleTemplates` / `templateRegistry`;
  **parts** register in `partRegistry` and are mounted by the layout / view
  shells via `/api/public/parts/:key` — they are **never** selected by
  `resolveTemplate()` (`packages/blocks/src/registry.ts`).
- Every `block_key` in a template/part must resolve to a registered block (see
  [Blocks](?doc=blocks)).
- **Bump `meta.version`** on a breaking structural change so customized installs
  get "update available" (their override stays live until they re-publish).
- After editing `packages/blocks`, rebuild + restart the API/admin
  (`pnpm --filter @cms/blocks build`) — same as adding a block; the web app HMRs
  the render components.
- Resolution is fail-open: a stored override that no longer validates against
  your code silently falls back to the code default. Don't rely on an old
  override shape surviving a schema change — bump the version and let editors
  reconcile.

## Design tokens

`packages/blocks/src/theme/tokens.ts` declares the theme's design tokens
(`themeTokens`, v1) — a `theme.json`-style map from a stable token name to the CSS
custom property that implements it in `theme.css` (a vitest asserts the two never
drift). **Today it's the declaration + types only — there is no token picker UI**;
the style editor and token-aware blocks are planned for v3. To change
colours/spacing now, edit the CSS variables directly — see
[Managing the theme → Design tokens](?doc=managing-the-theme).
