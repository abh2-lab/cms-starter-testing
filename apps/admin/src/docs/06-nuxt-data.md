---
title: Reading CMS data in Nuxt
order: 6
---

# Reading CMS data in Nuxt

How the public Nuxt site fetches content from the API and turns it into pages.
This is the core of "how public pages are generated".

## The API surface + the proxy

The site only ever calls **`/api/public/**`** with relative URLs. Nuxt's Nitro
layer proxies those to the real Fastify API (configured in
`apps/web/nuxt.config.ts` `routeRules`), so the browser and the SSR server both
hit the same origin:

```ts
// nuxt.config.ts (host)
routeRules: {
  '/api/public/**': { proxy: `${apiProxyTarget}/api/public/**` },
}
```

All reads are anonymous and cached server-side (DragonflyDB) for ~5 minutes.

## The fetch wrapper

Don't call `$fetch` directly — use the layer composable `cmsFetch` (auto-imported
across the theme layer). It targets `/api/public/*`, unwraps the API's
`{ data }` envelope, and returns `null` on 404 instead of throwing:

```ts
const { data: page } = await useAsyncData(
  () => `page:${slug.value}`,
  () => cmsFetch<PagePayload>(`/api/public/pages/${slug.value}`),
  { watch: [slug] },
);
```

Shared, cache-friendly helpers also exist: `useSiteSettings()` and
`useCmsMenu()` (deduped via `useAsyncData` so SSR + client don't double-fetch).

## Routing

| URL | Route file | Renders |
| --- | --- | --- |
| `/` | `pages/index.vue` | the `home` dynamic page |
| `/stories`, `/authors`, `/search`, `/contact` | named pages | archives / forms |
| `/author/<slug>` | `pages/author/[slug].vue` | one author |
| `/<slug>` | `pages/[slug]/index.vue` | page **or** category **or** tag |
| `/<category>/<article>` | `pages/[slug]/[article].vue` | one article |

Nuxt matches named/static routes **before** catch-alls. The single-segment
catch-all can't tell a page from a category from a tag by the URL alone, so it
asks the API:

```ts
// pages/[slug]/index.vue
const resolved = await cmsFetch(`/api/public/resolve/${slug}`);
// → { kind: 'page' | 'category' | 'tag' } → render the matching view
```

The admin rejects page slugs that would shadow a named route (see
`apps/api/src/lib/reserved-slugs.ts`), so a runaway slug can never hijack
`/stories` etc.

## Rendering a page

`PageView.vue` handles both page flavours:

- **Static** → inject `page.css` and `v-html` `page.html` (scripts don't run).
- **Dynamic** → walk `page.blocks[]`; each block arrives with its data
  **already resolved server-side** (the API ran every block's `load()` in
  parallel with per-block error isolation). The renderer is pure — it maps
  `block.key` → component via the block registry and passes
  `fields`/`options`/`data`:

```vue
<component
  :is="registry[block.key]"
  :fields="block.fields"
  :options="block.options"
  :data="block.data"
/>
```

Unknown or failed blocks render a small inline placeholder instead of breaking
the page.

## SSR + ISR

Pages render on the server by default. Hot list routes use stale-while-
revalidate so they're served as cached HTML and refreshed in the background:

```ts
// nuxt.config.ts (production)
routeRules: {
  '/': { swr: 300 },
  '/stories/**': { swr: 300 },
}
```

Article HTML is deliberately **not** cached at the Nuxt layer (the API response
is already cached, and caching draft-preview renders here would leak them).

## SEO

Each view sets meta with `useHead()`, pulling from the payload's `seo` object
(`metaTitle`, `metaDescription`, `ogImageUrl`, `canonicalUrl`, robots flags),
falling back to the title when a field is empty.

## Previews

`?preview=<token>` is forwarded to the API, which bypasses the published filter
and the cache. The `useAsyncData` key includes the token so a preview and a
normal visit never share a cache slot.
