# Custom Hocalwire CMS — Complete Project Overview

*As of 2026-06-03 · Phases 0-7 complete · scoping "Phase 8+: compete"*

## 1. What we've shipped

A self-hosted, single-install, multi-tenant-ready CMS for news publishers — closest cousin to Payload, but with reader-delivery and editorial workflow already tuned. Eight phases of the original roadmap are in: foundation, auth, content core, public delivery, media, search, async/queues, hardening.

**Stack baked in:** Fastify API · Vue 3 admin · Nuxt 4 public site · Postgres 18 + PgBouncer · DragonflyDB (Redis-compat) · Meilisearch · MinIO/Garage S3 · BullMQ + Sharp + Bull Board · Sentry · Pino.

**Apps (4):** `apps/api`, `apps/admin`, `apps/web`, `apps/worker`
**Packages (8+):** `db`, `types`, `config`, `queue`, `search`, `editor`, `blocks`, `email`
**Tooling:** pnpm 11 workspaces + Turborepo + Drizzle + Vitest + tsx.

---

## 2. Architecture at a glance

```
                  ┌─────────────────────────────────────────────┐
                  │              Public visitors                 │
                  └──────────────────┬──────────────────────────┘
                                     ▼
                         apps/web   (Nuxt 4, SSR/ISR)
                                     │  same-origin /api/public/*
                                     ▼
                         apps/api   (Fastify)
              ┌────────┬─────────────┼─────────────┬──────────┐
              ▼        ▼             ▼             ▼          ▼
          Postgres  Dragonfly   Meilisearch     S3        BullMQ
          (drizzle)  (cache+    (search)       (media)    queues
                     queue)                                  │
                                                             ▼
                                                    apps/worker
                                                    (6 queues)

                          apps/admin (Vue 3 SPA)
                              │  same-origin /api/admin/*
                              ▼
                         apps/api  (cookie-auth)
```

---

## 3. Admin dashboard — every page

The admin SPA runs at `:5173` (Vite dev) / `:8080` (built) and proxies `/api/*` to the API. Login → opaque session cookie → all admin pages.

### Sidebar navigation
- **Top** — Dashboard
- **Content** — All Content
- **Media** — Media Library
- **Taxonomy** — Taxonomies (editor+)
- **Structure** — Content Types, Pages, Menus, Redirects (super_admin)
- **Settings** — Site, Email, Users & Roles, API Keys, Webhooks (super_admin)
- **Insights** — Activity, Background Jobs (Bull Board), API Docs Generator

Top bar: content search, "View Site" link, theme toggle, help drawer, user menu.

### Every page

| Route | File | What it does |
|---|---|---|
| `/login` | [Login.vue](../apps/admin/src/pages/Login.vue) | Email+password → opaque session cookie |
| `/setup` | [Setup.vue](../apps/admin/src/pages/Setup.vue) | First-boot wizard: create super_admin + site name, optional sample data |
| `/` | [Home.vue](../apps/admin/src/pages/Home.vue) | Dashboard: 6 reorderable widgets (recent activity, publishing today, pending review, maintenance toggle, health, content-by-status) + stat cards |
| `/content` | [ContentList.vue](../apps/admin/src/pages/ContentList.vue) | Cursor-paginated table; status/type/author/search filters; bulk delete |
| `/content/new` | [ContentNew.vue](../apps/admin/src/pages/ContentNew.vue) | Type picker + title/slug → routes to editor |
| `/content/:id` | [ContentEdit.vue](../apps/admin/src/pages/ContentEdit.vue) | Full-screen editor: Tiptap body, status toolbar, taxonomy chips, schedule, SEO, revisions, media embeds |
| `/media` | [Media.vue](../apps/admin/src/pages/Media.vue) | Grid/list, presigned uploads, search, type filter, detail drawer (alt, captions, usage refs), bulk delete |
| `/activity` | [Activity.vue](../apps/admin/src/pages/Activity.vue) | Paginated audit log; client-side filters by resource + action |
| `/pages` | [PagesList.vue](../apps/admin/src/pages/PagesList.vue) | Static + dynamic pages table; filter by type/status; Publish/Archive/Duplicate/Delete |
| `/pages/new` | [PageNew.vue](../apps/admin/src/pages/PageNew.vue) | Static-or-dynamic picker |
| `/pages/:id` | [PageEditStatic.vue](../apps/admin/src/pages/PageEditStatic.vue) | Two-column raw HTML + CSS editor; layout template; SEO; schedule |
| `/pages/:id/build` | [PageBuildView.vue](../apps/admin/src/pages/PageBuildView.vue) → [BlocksEditor.vue](../apps/admin/src/components/editor/BlocksEditor.vue) | Unified blocks editor (pages + templates + parts): block library + flat list, scoped live preview, floating structure popup |
| `/pages/help/blocks` | [DynamicBlocksGuide.vue](../apps/admin/src/pages/DynamicBlocksGuide.vue) | Developer guide for adding new blocks end-to-end |
| `/menus` | [MenusList.vue](../apps/admin/src/pages/MenusList.vue) | Inline-create + list of menus |
| `/menus/:id` | [MenuEditor.vue](../apps/admin/src/pages/MenuEditor.vue) | Drag-reorder tree; URL or content-link items; bulk save in one PUT |
| `/content-types` | [ContentTypesList.vue](../apps/admin/src/pages/ContentTypesList.vue) | Cards of every type; delete blocked if rows exist |
| `/content-types/new` `/:id` | [ContentTypeForm.vue](../apps/admin/src/pages/ContentTypeForm.vue) | Define name/slug/icon + custom field definitions (text, rich text, media, repeater, relation) |
| `/taxonomies` `/:id` | [TaxonomiesList.vue](../apps/admin/src/pages/TaxonomiesList.vue) | Two-column: tree of taxonomies + per-term editor with hierarchy |
| `/redirects` | [Redirects.vue](../apps/admin/src/pages/Redirects.vue) | 301/302 mappings; CSV import; status filters |
| `/settings/site` | [SiteSettings.vue](../apps/admin/src/pages/SiteSettings.vue) | Tabbed: general, SEO defaults, social, branding, advanced |
| `/settings/email` | [EmailSettings.vue](../apps/admin/src/pages/EmailSettings.vue) | SMTP host/port/auth, from address, templates |
| `/settings/users` | [Users.vue](../apps/admin/src/pages/Users.vue) | Invite, role change, deactivate; bootstrap super_admin protected |
| `/settings/api-keys` | [ApiKeys.vue](../apps/admin/src/pages/ApiKeys.vue) | Create, scope, rotate, delete; secret revealed once |
| `/settings/webhooks` | [Webhooks.vue](../apps/admin/src/pages/Webhooks.vue) | Create + test endpoint, view delivery log, rotate secret |
| `/api-docs` | [ApiDocsGenerator.vue](../apps/admin/src/pages/ApiDocsGenerator.vue) | OpenAPI/Swagger generator (super_admin) |

Role gating is enforced both in the sidebar and on each route (`requireAdminRole`).

---

## 4. Behind-the-scenes systems

### pnpm scripts

**Root** (`pnpm <cmd>`):
- `dev` — all apps in parallel
- `build` — turbo build everything
- `lint` / `lint:fix` — ESLint (type-aware)
- `typecheck` — all packages via tsc
- `test` — Vitest across packages
- `format` / `format:check` — Prettier
- `clean` — wipe dist/.turbo/node_modules

**Per app:**

| Command | Purpose |
|---|---|
| `pnpm --filter @cms/api dev` | Fastify with tsx watch on :3000 |
| `pnpm --filter @cms/api seed:test-admin` | Create `admin@test.com / test1234` + demo content type |
| `pnpm --filter @cms/api seed:examples` | Full news sample data (types, terms, posts, menus, redirects) |
| `pnpm --filter @cms/api audit:prune` | Purge audit_log older than N days |
| `pnpm --filter @cms/api meili:reindex` | Full Meili reindex (`--force` bypasses checksums) |
| `pnpm --filter @cms/admin dev` | Vite on :5173 |
| `pnpm --filter @cms/web dev` | Nuxt on :3001 |
| `pnpm --filter @cms/worker dev` | BullMQ worker on :3100 |

**Database** (in `packages/db`):
- `pnpm db:generate` — generate migration from schema diff
- `pnpm db:migrate` — apply migrations to `DATABASE_URL`
- `pnpm db:push` — push schema directly (dev only)
- `pnpm db:studio` — Drizzle Studio on :5555

### scripts/ directory
- [scripts/backup-postgres.sh](../scripts/backup-postgres.sh) — logical dump → S3 with retention sweep; Coolify cron
- [scripts/restore-postgres.sh](../scripts/restore-postgres.sh) — `<s3-key> [target-url]` restore
- [scripts/verify-backup.sh](../scripts/verify-backup.sh) — weekly: restore latest into throw-away container, query `content`

### docker-compose
Infra: `postgres:18-alpine` (5432), `pgbouncer` (6432), `dragonfly` (6379), `meilisearch:v1.11` (7700), `minio` (9000/9001), `minio-setup` (one-shot `cms-media` bucket).
Apps: `api` (3000), `worker` (3100, /ready probe), `admin` (8080), `web` (3001).
Backup profile: `docker compose run --rm backup`.

Local dev uses **Hybrid**: backing services in Docker via the compose file, apps from source via `pnpm dev`. App containers should be stopped locally to free ports.

### Turbo
[turbo.json](../turbo.json) defines `build`, `dev` (persistent, no-cache), `lint`, `typecheck`, `test`, `clean`. Topological deps via `^build`. Filter with `--filter @cms/api`; selective with `--affected`.

### CI/CD
- `.github/workflows/ci.yml` — build → lint → test → CVE audit (HIGH/CRITICAL block PRs); Node 22 + pnpm cache
- `.github/workflows/loadtest.yml` — manual/scheduled load run

### No system cron / k8s CronJobs
Recurring jobs (backups, audit prune, reindex, scheduled-publish sweep, Meili drift sweep) are split between **Coolify scheduled tasks** and the **worker's BullMQ repeatable jobs** (see §9).

---

## 5. Content flow — write → store → serve

### 5.1 Authoring
The admin editor is **Tiptap** (`@tiptap/vue-3`) via [apps/admin/src/components/RichTextEditor.vue](../apps/admin/src/components/RichTextEditor.vue) and [apps/admin/src/composables/useBodyEditor.ts](../apps/admin/src/composables/useBodyEditor.ts). StarterKit + custom extensions (Table, Embed, SlashCommand). The body is stored as Tiptap JSON inside a `custom_fields` JSONB object keyed by field-definition slugs.

The schema of `custom_fields` is enforced by **content_types.field_definitions** (a Zod-validated JSON schema). Standard fields surface as native inputs; rich text fields surface as Tiptap; media fields embed the media library picker.

### 5.2 Save / Publish — API + state machine
[apps/api/src/routes/admin/content.ts](../apps/api/src/routes/admin/content.ts):
- `POST /api/admin/content` — create draft (author forced)
- `PATCH /api/admin/content/:id` — update + write **one revision row per save**
- `POST /api/admin/content/:id/transitions` — guarded state change

**State machine:**

```
draft → in_review | scheduled | published
in_review → draft | approved
approved → draft | scheduled | published
scheduled → draft | published
published → archived
archived → draft
```

**On publish:**
1. Validate required custom fields (enforced at publish, not at draft).
2. Lock content row in a transaction.
3. Set `status='published'`, `published_at=now()` (if null), `published_by=user.id`.
4. Clamp `publish_at` to now if missing/future.
5. Insert into `content_status_transitions` (audit).
6. Invalidate `cache:content:{tenantId}:{typeSlug}:{slug}` + archive patterns.
7. Enqueue **search-index upsert** + dispatch `content.published` webhook (fire-and-forget).

**Scheduled publish:** `to_status='scheduled'` requires `publish_at`. The worker auto-publishes when `publish_at <= now()` via a BullMQ delayed job (see §9).

### 5.3 Storage — Drizzle schema
[packages/db/src/schema/](../packages/db/src/schema/):
- **content** — id, tenant_id, content_type_id, title, slug, status, author_id, published_by, publish_at, published_at, unpublish_at, custom_fields JSONB, locale, translation_group_id, view_count. Indexes on (tenant, status, publish_at), (tenant, type, status), translation_group_id.
- **content_revisions** — append-only; `snapshot JSONB`, monotonic `revision_number` per content.
- **content_status_transitions** — every transition: from/to status, changed_by, comment.
- **content_view_events** — analytics log; rolled up to `content.view_count` by worker.
- **content_types** — slug, field_definitions JSONB, settings JSONB, preview_path, submission_access.

### 5.4 Cache layer
[apps/api/src/lib/cache.ts](../apps/api/src/lib/cache.ts):
- Keys: `cache:content:{tenantId}:{typeSlug}:{slug}` (5-min TTL), `cache:archive:{tenantId}:{type}:...`, `cache:menu:{tenantId}:{location}` (5-min).
- **Single-flight dedup**: an in-flight Map deduplicates concurrent loaders by key — thundering-herd guard.
- **Fail open**: Dragonfly error → fallback to DB; no cache miss can break a public read.
- Invalidation: explicit `invalidateKeys()` on writes, `invalidatePattern()` for archive sweeps (SCAN + UNLINK).

### 5.5 Public serving — one full request
A visitor opens `https://site.example/article/some-slug`:
1. Nuxt route [apps/web/app/pages/article/[slug].vue](../apps/web/app/pages/article/[slug].vue) calls `cmsFetch('/api/public/content/article/some-slug')` via `useAsyncData` with key `article:{slug}:{preview-or-public}`.
2. Nitro proxies same-origin to `apps/api`. Public router → [apps/api/src/routes/public/content.ts](../apps/api/src/routes/public/content.ts):
   - Resolve tenant by domain → `PUBLIC_TENANT_SLUG`.
   - SELECT content INNER JOIN content_types (by slug), LEFT JOIN content_seo, LEFT JOIN admin_users.
   - Filter: `status='published' AND (publish_at IS NULL OR publish_at <= now()) AND (unpublish_at IS NULL OR unpublish_at > now())`.
   - Second query: taxonomy terms via the junction.
   - Resolve S3 URLs (hero, og, twitter) via `objectUrl()`.
   - Dragonfly cache, 5-min TTL.
3. Response → Nuxt renders SSR; `route rules` in Nuxt give article routes ISR/SWR.
4. View event POSTed back via beacon (debounced) → `content_view_events`.

### 5.6 Preview (drafts)
Token is a base64url HMAC of `{cid, exp}` ([apps/api/src/lib/preview-token.ts](../apps/api/src/lib/preview-token.ts)). `?preview=<token>` bypasses both the published-status filter and the cache; token only validates against the exact content id (no cross-slug reuse).

---

## 6. Pages — CMS pages (not Vue routes)

A second first-class CMS object distinct from posts/content. Two flavors: **static** (raw HTML + CSS) and **dynamic** (block-composed via builder).

### 6.1 Schema
[packages/db/src/schema/pages.ts](../packages/db/src/schema/pages.ts):
- **pages** — id, tenant_id, slug (unique per tenant), title, `type ∈ {static, dynamic}`, status (same 6-state machine as content), `html`, `css`, `layout_template` (static-only), `template_key`, `blocks JSONB` (dynamic-only), `seo JSONB`, locale, translation_group_id, `system_managed` (blocks deletion of seeded rows), author_id, published_by, publish_at, unpublish_at, published_at, deleted_at.
- **page_revisions** — same append-only snapshot pattern as content.
- **page_status_transitions** — audit log.
- **page_templates** — user-saved arrangements (`block_keys JSONB`).

### 6.2 Admin UI
[PagesList.vue](../apps/admin/src/pages/PagesList.vue) — filterable table with stat tiles, bulk publish/archive/delete, per-row Edit/Duplicate/View.

**Static editor** ([PageEditStatic.vue](../apps/admin/src/pages/PageEditStatic.vue)) — two-column sticky: HTML + CSS, layout template picker, SEO panel, schedule.

**Unified blocks editor** ([BlocksEditor.vue](../apps/admin/src/components/editor/BlocksEditor.vue), mounted via [PageBuildView.vue](../apps/admin/src/pages/PageBuildView.vue) for pages and [StructureEditView.vue](../apps/admin/src/pages/StructureEditView.vue) for theme templates/parts) — one editor for dynamic pages, templates and parts:
- **Left** ([EditorLeftPanel.vue](../apps/admin/src/components/editor/EditorLeftPanel.vue)) — two tabs: the block library ([BuilderLibrary.vue](../apps/admin/src/components/builder/BuilderLibrary.vue)) + a flat drag-reorder list of placed blocks
- **Centre** — a live preview iframe scoped to what's edited (a part renders on its own)
- **Structure popup** ([BlockStructureModal.vue](../apps/admin/src/components/editor/BlockStructureModal.vue)) — floating, draggable, minimizable tree of [EditorBlockCard.vue](../apps/admin/src/components/editor/EditorBlockCard.vue) cards with inline settings and up/down reorder
- Save-as-template via [SaveTemplateDialog.vue](../apps/admin/src/components/builder/SaveTemplateDialog.vue)

### 6.3 API
- Admin: `GET/POST/PATCH/DELETE /api/admin/pages`, `POST /api/admin/pages/:id/transitions`, `POST /api/admin/pages/:id/preview-token` ([routes/admin/pages.ts](../apps/api/src/routes/admin/pages.ts))
- Block metadata: `GET /api/admin/blocks` ([routes/admin/blocks.ts](../apps/api/src/routes/admin/blocks.ts)) — returns the dev-shipped registry's fields/options/categories
- Public: `GET /api/public/pages/:slug` ([routes/public/pages.ts](../apps/api/src/routes/public/pages.ts)) — for dynamic pages, fans out block loaders in parallel; each loader wrapped in try/catch so one broken block doesn't 500 the page
- Block preview: `GET /api/public/blocks/:key/preview` ([routes/public/blocks.ts](../apps/api/src/routes/public/blocks.ts))

### 6.4 Public render
[apps/web/app/pages/page/[slug].vue](../apps/web/app/pages/page/[slug].vue):
- Fetches `/api/public/pages/${slug}` with optional `?preview=token`
- Static page: `<Head><Style>` for CSS + `v-html` for HTML
- Dynamic page: walks `blocks[]`, resolves each `block_key` to a Vue component via [useBlockRegistry.ts](../apps/web/app/composables/useBlockRegistry.ts), renders with `{ fields, options, data }` props
- Three per-block states: normal render, `unknown_block` placeholder, `load_failed` placeholder

### 6.5 Dynamic blocks
Blocks are **developer-shipped** with two halves:

**Server half** in [packages/blocks/src/blocks/](../packages/blocks/src/blocks/) — each block exports `{ meta, load(ctx, { fields, options }) }`. `meta` defines key, label, category, icon, **fields** (user-edited copy like badge/title) and **options** (data bindings like content_type + slug + count).

**Web half** in [apps/web/app/components/blocks/](../apps/web/app/components/blocks/) — Vue component for that key.

**Registries** keep them in sync — [packages/blocks/src/registry.ts](../packages/blocks/src/registry.ts) (loaders) and [useBlockRegistry.ts](../apps/web/app/composables/useBlockRegistry.ts) (components).

Shipped blocks: `hero`, `latest-news`, `featured-article`, `impact-stats`. Templates: `home-default`, `static-textpage`.

A recent feature lets options reference a content type via the new `content_type_slug` field type with a live picker.

### 6.6 Preview
Two flows:
- **Block preview** (recent commit `7d17dd5`): editor clicks Preview on a placed block → opens `/preview/block/{key}` in a new tab → API resolves defaults, auto-fetches first published row matching any `content_slug` binding so previews show real content, runs `load()` → web renders with same registry → byte-identical to production.
- **Page draft preview**: admin calls `POST /admin/pages/:id/preview-token` → opens `${siteSettings.siteUrl}/{slug}?preview={hmac-token}` → public route accepts the token, bypasses published-filter and cache.

---

## 7. Menus

### 7.1 Schema
[packages/db/src/schema/menus.ts](../packages/db/src/schema/menus.ts):
- **menus** — id, tenant_id, name, slug (unique per tenant), description, is_active, timestamps. Slug is the lookup key ("main-nav", "footer-nav").
- **menu_items** — id, tenant_id, menu_id (cascade delete), parent_id (self-FK, `SET NULL` on delete → orphan children), label, url (direct), content_id (FK to content, `SET NULL` on delete), open_in_new_tab, icon, sort_order, is_active, attributes JSONB.

### 7.2 Admin UI
- [MenusList.vue](../apps/admin/src/pages/MenusList.vue) — inline-create row + table with edit/delete; 409 on slug conflict.
- [MenuEditor.vue](../apps/admin/src/pages/MenuEditor.vue) — left: drag-reorderable tree with nesting; right: tabbed Add/Edit form (Custom URL tab / Content Link tab with content picker). Bulk save via one PUT.

### 7.3 API
[apps/api/src/routes/admin/menus.ts](../apps/api/src/routes/admin/menus.ts):
- `GET/POST/PATCH/DELETE /api/admin/menus`
- `POST/PATCH/DELETE /api/admin/menus/:menuId/items`
- `PUT /api/admin/menus/:menuId/items/order` — bulk reorder/reparent in a single transaction

[apps/api/src/routes/public/menus.ts](../apps/api/src/routes/public/menus.ts):
- `GET /api/public/menus/:location` — returns the active tree
- Content-linked items are hydrated: response includes `contentSlug` + `contentType` so the frontend builds URLs without a second round-trip
- Tree depth capped at 10 (parent-cycle guard)
- 5-min TTL at `cache:menu:{tenantId}:{location}`; HTTP `Cache-Control: public, max-age=300, s-maxage=300`

### 7.4 Public consumption
[apps/web/app/composables/useCmsFetch.ts](../apps/web/app/composables/useCmsFetch.ts) exports `useCmsMenu(slug)`. [apps/web/app/layouts/default.vue](../apps/web/app/layouts/default.vue) calls it for `main-nav` and `footer-nav`. [SiteHeader.vue](../apps/web/app/components/SiteHeader.vue) + [SiteFooter.vue](../apps/web/app/components/SiteFooter.vue) render the items.

> **Known gap:** invalidation on admin save is still TODO — caches drift up to 5 min. The pattern-invalidation utility exists; it just isn't wired into the menu writes yet.

### 7.5 How to use
- Create a menu with slug `main-nav` in admin → /menus.
- Add items (Custom URL or Content Link) → reorder/nest → save.
- The public layout fetches and renders automatically.

---

## 8. Taxonomies

Unified framework for both **categories** (hierarchical) and **tags** (flat).

### 8.1 Schema
[packages/db/src/schema/taxonomy.ts](../packages/db/src/schema/taxonomy.ts):
- **taxonomies** — id, tenant_id, name, slug, `kind ∈ {category, tag}`, `is_hierarchical bool` (only valid for categories — API rejects tags with hierarchy). Unique `(tenant_id, slug)`.
- **taxonomy_terms** — id, tenant_id, taxonomy_id (cascade), name, slug, description, sort_order, parent_id (self-FK, `SET NULL`). Unique `(taxonomy_id, slug)` → slugs scoped per taxonomy, not globally.
- **content_taxonomy_terms** — junction, composite PK `(content_id, term_id)`, cascade both sides, reverse-lookup index on term_id.

Slug format enforced by `/^[a-z][a-z0-9-]*$/`.

### 8.2 Admin UI
[TaxonomiesList.vue](../apps/admin/src/pages/TaxonomiesList.vue): two-column layout — left sidebar groups taxonomies by kind (Categories / Tags); right panel lists/edits terms for the selected one, with drag-reorder and hierarchy visualization for categories.

Flipping `kind` to `tag` auto-clears `is_hierarchical`.

The post editor attaches terms via the `taxonomyTermIds: string[]` field on `PATCH /admin/content/:id` — server replaces the full set atomically.

### 8.3 API
[apps/api/src/routes/admin/taxonomies.ts](../apps/api/src/routes/admin/taxonomies.ts):
- `GET/POST/PATCH/DELETE /api/admin/taxonomies`
- `GET/POST/PATCH/DELETE /api/admin/taxonomies/:taxonomyId/terms`

Public archive ([apps/api/src/routes/public/archive.ts](../apps/api/src/routes/public/archive.ts)):
- `GET /api/public/archive/:type?category=:termSlug` — paginated listing of a content type, optionally filtered by **any** term slug (not scoped to a taxonomy)
- Each item includes a `taxonomy: [{termSlug, termName, taxonomySlug}]` array

Single content detail also returns the taxonomy array.

### 8.4 Search indexing
[packages/search/src/indexing.ts](../packages/search/src/indexing.ts) indexes three filterable slug arrays in Meilisearch:
- `taxonomyTermSlugs` — all taxonomies
- `categoryTermSlugs` — only `kind=category`
- `tagTermSlugs` — only `kind=tag`

Plus rich `taxonomy[]` for display. Indexing is triggered on every content write through the `search-index` queue (§9).

### 8.5 Hierarchy rules
- `is_hierarchical=true` (categories) → terms can have `parent_id`; admin picker shows tree depth
- `is_hierarchical=false` (tags) → `parent_id` always null; admin hides parent picker
- Deleting a parent term orphans children (`SET NULL`) — never cascade
- Sort: `sort_order` then alphabetical by name

### 8.6 Gap
The web side doesn't yet have `/category/[slug].vue` or `/tag/[slug].vue` archive routes — the API and Meili filters are ready; the Nuxt pages need to be added when needed.

---

## 9. Background jobs — BullMQ on Dragonfly

[apps/worker/src/index.ts](../apps/worker/src/index.ts) boots six workers, each with its own Redis connection so one stalled queue doesn't starve others. Bull Board UI mounted at `/api/admin/queues` (super_admin only). Pino logs carry `reqId` end-to-end; Sentry captures failed jobs.

### Six queues

| Queue | Job types | Producer | Worker | Concurrency | Retry |
|---|---|---|---|---|---|
| `search-index` | upsert, remove | admin content/page routes; schedule-publish on flip | [search-index.ts](../apps/worker/src/processors/search-index.ts) | 8 | 5x exp 1→16s |
| `webhook-deliver` | deliver | `dispatchEvent()` from content & media routes | [webhook-deliver.ts](../apps/worker/src/processors/webhook-deliver.ts) | 16 | 5x exp 30s→8m |
| `schedule-publish` | publish, unpublish | admin content route on `publish_at` set | [schedule-publish.ts](../apps/worker/src/processors/schedule-publish.ts) | 4 | 3x fixed 5s |
| `image-process` | generateVariants | admin media route on upload | [image-process.ts](../apps/worker/src/processors/image-process.ts) | 2 (CPU-bound) | 3x exp 5s |
| `email-send` | send | [review-notify.ts](../apps/api/src/lib/review-notify.ts) | [email-send.ts](../apps/worker/src/processors/email-send.ts) | 4 | 5x exp 1→16m |
| `maintenance` | scheduled-publish-sweep, meili-drift-sweep | boot-time repeatables | [maintenance.ts](../apps/worker/src/processors/maintenance.ts) | 1 | 1 attempt |

Deterministic job IDs (`upsert-{contentId}`, `publish-{contentId}`) make re-enqueues idempotent.

### Scheduled publishing
1. Admin saves with `publish_at` future → API enqueues `producers.schedule.publishAt(id, when)` with `delay = max(0, when - now)` and job id `publish-{id}`.
2. Re-editing overwrites the delayed job.
3. At fire time: row re-read with `FOR UPDATE`, date validated unchanged, status → published, audit row inserted, search-index + webhook + cache invalidation enqueued.
4. **Safety net**: hourly `scheduled-publish-sweep` re-enqueues any overdue rows lost from Dragonfly during restarts.

Daily `meili-drift-sweep` at 03:15 UTC reconciles the Meili index against Postgres.

### Image processing
Upload → S3 → `media` row `pending` → `generateVariants` job. Worker fetches bytes, Sharp generates **6 variants** (thumbs in webp+avif; sm/md/lg in webp; lg in avif), writes each to S3, batches `media_variants` rows with `onConflictDoNothing`, marks `ready`, dispatches `media.processed` webhook.

### Webhook delivery
On `content.published` / `media.processed` / etc., `dispatchEvent()` queries `webhooks` table with Postgres `@>` event-array filter (GIN index), then enqueues one delivery per match. Worker: HMAC-SHA256 the payload, POST with 10s timeout, persist a `webhook_deliveries` row (response status/body truncated to 4KB, retry timestamps). 14-day failed retention for forensics.

### Email
Per-tenant transport resolved from `email_settings` (cached, rebuilt on version change to reuse SMTP pool). Kinds: `review_requested`, `review_approved`, `review_rejected`, `reader_submission`.

### Concurrency env vars
`WORKER_IMAGE_CONCURRENCY=2`, `WORKER_WEBHOOK_CONCURRENCY=16`, `WORKER_SEARCH_INDEX_CONCURRENCY=8`, `WORKER_SCHEDULE_PUBLISH_CONCURRENCY=4`, `WORKER_EMAIL_CONCURRENCY=4`. Worker also serves a `/ready` health probe on `WORKER_PORT=3100`.

---

## 10. Where we are vs. what's next

**Done (Phases 0-7):** Foundation, opaque-session auth + RBAC, content core with 6-state machine + revisions + audit, public delivery with Dragonfly cache + Nuxt ISR/SWR, presigned S3 media + Sharp variants, Meilisearch admin+public search, BullMQ worker + Bull Board, structured logging + Sentry + health probes + rate limits + backup/restore/verify.

**Backlog (Phase 8+: compete):**
1. e2e tests for the golden flows (currently ~19 unit/integration tests, zero e2e)
2. Load test the public path
3. CDN-in-front + purge-on-publish (and wiring menu-cache invalidation)
4. Seed/setup wizard polish (`/setup` exists; first-run UX can be richer)
5. Richer editor blocks/embeds (today: Tiptap StarterKit)
6. News distribution — RSS, Google News sitemap, NewsArticle JSON-LD, Web Stories
7. Editorial analytics dashboard (data is in `content_view_events`)
8. Edit-locking/presence → real-time collab
9. Later: paywall, subscriptions, newsletters, realize multi-edition i18n (schema is already multi-tenant + translation_group ready)
10. Public `/category/[slug]` and `/tag/[slug]` archive pages (API ready, pages not built)
