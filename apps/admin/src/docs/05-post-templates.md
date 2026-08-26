---
title: Post templates
order: 5
---

# Post templates

Posts (content rows — articles, etc.) render through a **single template**
chosen from a theme-provided list, the WordPress way. This generalises the old
"every article uses one fixed layout" into selectable layouts (standard,
video-led, photo essay, long-read, …).

## How a template is resolved

For a given post the template key is resolved in priority order:

```text
content.template_key            (per-post override)
  ?? contentType.settings.templates.default   (per-type default)
  ?? 'article-standard'                        (safe fallback)
```

So a content type sets the default all its posts use, and an individual post
can override it. This precedence is implemented once in `resolveTemplate()`
(`packages/blocks/src/templates/resolve-template.ts`, role `single`).

## Where templates are defined

Like blocks, a post template is two halves on one key:

| Half | Location |
| --- | --- |
| **Metadata** (key, label, description) | `packages/blocks/src/post-templates.ts` → exposed via `GET /api/admin/post-templates` |
| **Render mapping** (key → layout) | theme `composables/usePostTemplateRegistry.ts` |

Unlike a page template (a *list of blocks*), a post template selects a whole
article layout. Today both shipped templates render through `ArticleView.vue`,
switching a **layout variant** (`article-standard` → `decode`, `article-feature`
→ `nyt`); the mapping can graduate to a distinct component per key later. Either
way, the theme must handle every key the metadata lists.

## Render path

The public content API (`/api/public/content/<type>/<slug>`) returns the
already-resolved `templateKey`. `ArticleView.vue` calls
`resolvePostTemplateVariant(story.templateKey)` to pick the layout variant
(falling back to the legacy `customFields.variant`, then `decode`) and renders
`<article class="article-variant-<variant>">`. An unknown key never blank-renders
— it falls through to the default variant.

The article **body** now renders from the `single` block-tree: the content API
returns a composed `blocks` array (the `post-content` field block reading the
post's box), and `ArticleView.vue` renders it in its content column via
`<BlockTree>` instead of a hard-coded body. The surrounding chrome (hero, share
rail, related, author bios) stays in `ArticleView.vue`, and the body **stays in
TipTap** (`post-content` wraps `renderTiptap`). See
[Blocks → the box](?doc=blocks).

## Choosing a template in the admin

- **Per content type (default):** Content Types form → "Default post template",
  saved to `settings.templates.default`.
- **Per post (override):** the content editor's sidebar → "Template", with a
  "Use type default" option that clears the override.

> Changing a content type's default reflects on already-cached public pages
> after the cache TTL elapses.

## Add a post template (developer)

1. **Metadata** — add an entry to `postTemplateRegistry` in
   `packages/blocks/src/post-templates.ts` (`{ key, label, description }`). Keep
   `DEFAULT_POST_TEMPLATE_KEY` pointing at a key that exists.
2. **Render mapping** — in
   `apps/web/themes/default/app/composables/usePostTemplateRegistry.ts`, map the
   new key in `POST_TEMPLATE_VARIANTS` and add the variant to the
   `ArticleVariant` union.
3. **Styles** — add an `.article-variant-<variant>` block in
   `components/ArticleView.vue` (override fonts/spacing/width). For a radically
   different layout, map the key to a separate component instead of a variant.
4. **Rebuild** — `pnpm --filter @cms/blocks build` + restart the API; the new
   template then shows in both the per-type default and per-post pickers.
