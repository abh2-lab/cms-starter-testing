# Phase 1 — In-Admin AI Assistant (v1) — Implementation Plan

## Context

We are adding a **floating AI chat assistant inside the admin app** for `admin` + `super_admin`
operators (not developers). It knows the running CMS and helps manage it through chat. One backend
route runs a **manual tool-use loop** over the EXISTING `/api/admin/*` endpoints (already
Zod-validated, role-gated, tenant-scoped, audit-logged), riding the admin session cookie so every
action it takes inherits RBAC + an audit trail for free.

**Why now:** the CMS is feature-complete (roadmap Phases 0–7 done) and Phase 2's AI theme-authoring
kit already landed. Phase 1 brings AI to the *operator* surface. v1 ships a safe, useful assistant
that can do the low-risk content/structure work and *advises* on anything that could break the live
site; v2 (deferred) lets it execute the sensitive set behind a confirm gate.

**Settled decisions confirmed with the user (do not re-litigate):**
- **Provider abstraction = OpenAI-compatible only.** One wire format (Chat Completions + `tools` +
  SSE). The `provider` field is a UX preset that fills the base URL. Reaches OpenAI directly and
  Anthropic/Google via their first-party OpenAI-compatible endpoints, plus OpenRouter/Groq/vLLM/
  Ollama/LM Studio/Azure. (The `claude-api` "use the Anthropic SDK" rule is intentionally overridden
  by the provider-agnostic requirement.)
- **Static-page CSS guidance** lives as a worked example in the existing Hub doc
  `04-page-templates.md` + a one-line pointer in the help drawer.
- **Dynamic-page authoring is deferred to v1.1.** v1 authors **static** pages and can **read/describe**
  dynamic pages, but does not compose block trees.

---

## Contradictions & gaps found in the code (resolved in this plan)

1. **"Describe the CMS" cannot reuse `admin/docs.ts` directly.** That generator is
   `requireAdminRole('super_admin')`-gated and POST-shaped (takes a section selection). The chat is
   `admin`+, so a non-super admin would 403. **Resolution:** `describe_cms` composes its summary from
   the **admin-readable GET endpoints** (`content-types`, `taxonomies`, `menus`, `blocks`, site
   settings) — all gated at "any auth" — rather than calling `docs.ts`. (Optionally, later, refactor
   `generateMarkdown()` into a shared lib callable at admin+.)
2. **Config GET is `super_admin`-only, but the chat UI is `admin`+.** Cloning monitoring means
   `GET /api/admin/settings/ai` is super-admin-gated — an `admin` user can't read it to learn whether
   AI is on. **Resolution:** add a tiny **admin-readable** `GET /api/admin/ai/status` returning only
   `{ enabled, configured }` (no secrets, no provider/model) so the panel can decide visibility.
3. **"SSE" is delivered over POST, not `EventSource`.** `EventSource` is GET-only and can't send a
   body or rely on the same fetch credentials cleanly. **Resolution:** the chat route responds with
   `Content-Type: text/event-stream` to a **POST**, and the client consumes it via
   `fetch(...).body.getReader()` (manual SSE frame parsing). Same on-wire SSE format, different client.
4. **No `user`/`role` admin endpoints exist in the tool surface.** So "user & role changes" being
   advisory is automatic — there is nothing to wrap. We still register an `advise_*` tool so the
   model has a defined, safe response path.
5. **Static-page CSS is injected globally, not engine-scoped.** `PageView.vue` emits
   `<Head><Style>{{ page.css }}</Style></Head>` — it applies to the whole document (header/footer/
   chrome). The "scoped CSS" phrasing in `04-page-templates.md` means *authored-to-be-scoped*, not
   engine-scoped. The docs example must teach **manual** scoping. (Consistent with the
   trusted/unsanitized static-HTML model — we do not add sanitization.)

---

## 1 · Phased breakdown

| Phase | Scope | Primary files |
|---|---|---|
| **1a** | `ai_settings` table + migration + super-admin GET/PATCH route + admin-readable status route + API client + Vue config tab | `packages/db/src/schema/ai-settings.ts`, `apps/api/src/routes/admin/ai-settings.ts`, `apps/api/src/routes/admin/ai-chat.ts` (status), `apps/admin/src/api/ai-settings.ts`, `apps/admin/src/pages/InfrastructureSettings.vue` |
| **1b** | Chat route + OpenAI-compatible client + streaming + manual loop scaffold | `apps/api/src/routes/admin/ai-chat.ts`, `apps/api/src/lib/ai/openai-compat-client.ts`, `apps/api/src/lib/ai/chat-loop.ts` |
| **1c** | Tool layer: registry, `fastify.inject` dispatch, executory tool map, advisory tools, `describe_cms` | `apps/api/src/lib/ai/tools/*.ts`, `apps/api/src/lib/ai/tool-dispatch.ts` |
| **1d** | Floating chat panel, role/enable gating, incremental MD streaming render, tool status chips | `apps/admin/src/components/AiAssistant.vue`, `apps/admin/src/composables/useAiChat.ts`, `apps/admin/src/api/ai-chat.ts`, mount in `apps/admin/src/App.vue` |
| **1e** | Static-page conflict-free CSS docs (worked example) + drawer pointer | `apps/admin/src/docs/04-page-templates.md`, `apps/admin/src/lib/helpContent.ts` |
| **1f** | Help-drawer vs Documentation-Hub division of responsibility + de-dup audit | `apps/admin/src/lib/helpContent.ts`, `apps/admin/src/docs/*.md` (audit only) |

**Build order & commands** (pnpm@11 + Turborepo; `@cms/db` consumed from `dist`):

```bash
# 1a — after writing the schema file + index export:
# VERIFY the latest migration first — current latest is 0024_add_page_content_mode_and_body.sql,
# so the new one will be 0025_*. drizzle-kit auto-numbers from meta/_journal.json; confirm nobody
# added a migration since this plan was written before generating.
pnpm db:generate                         # creates packages/db/migrations/0025_*.sql (next after 0024)
pnpm db:migrate                          # applies it (needs DIRECT_DATABASE_URL — non-pooled)
pnpm --filter @cms/db build              # REQUIRED: API imports @cms/db from dist
# then build/run API + admin:
pnpm --filter @cms/api dev               # or the hybrid dev stack
pnpm --filter @cms/admin dev             # :5173

# gate (no prettier --write; eslint is the enforced gate):
pnpm lint
```

> The `@cms/db` rebuild after the schema change is mandatory — the API will not see `ai_settings`
> until `dist` is rebuilt (per repo convention).

---

## 2 · AI config tab spec (clone of Monitoring)

### 2.1 Schema — `packages/db/src/schema/ai-settings.ts`

Mirror `monitoring-settings.ts` exactly. One row per tenant; `bytea` for the encrypted key.

```ts
export const aiSettings = pgTable('ai_settings', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
  enabled: boolean('enabled').notNull().default(false),
  provider: text('provider'),               // 'openai' | 'anthropic' | 'google' | 'custom' (UX preset)
  apiKeyEncrypted: bytea('api_key_encrypted'),
  model: text('model'),                      // free text, no default
  baseUrl: text('base_url'),                 // nullable; preset by provider or custom
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('ai_settings_tenant_id_uniq').on(t.tenantId).nullsNotDistinct()]);
export type AiSettings = typeof aiSettings.$inferSelect;
export type NewAiSettings = typeof aiSettings.$inferInsert;
```

- Add `export * from './ai-settings.js';` to `packages/db/src/schema/index.ts` (group with the other
  `*-settings` exports).
- Tenancy is handled identically to `monitoring_settings` (one row, `nullsNotDistinct`, `tenantFilter`
  on read, `tenantId: session.user.tenantId` on insert) — no new tenancy decision needed.

### 2.2 Super-admin config route — `apps/api/src/routes/admin/ai-settings.ts`

Clone `monitoring-settings.ts`. `addHook('preHandler', requireAdminAuth)`; both verbs gated with
`requireAdminRole('super_admin')`; mounted in `server.ts` with prefix `/api/admin/settings/ai`.

- `GET /` → `toMasked(row)`: returns `{ enabled, provider, model, baseUrl, apiKey: MASK|'' , isConfigured }`.
  **Never returns the plaintext key.**
- `PATCH /` → mask-aware upsert. Reuse the `MASK = '••••••••'` + `applySecret()` idiom:
  `apiKey === MASK` → no change; `''` → clear; else `encryptWebhookSecret(value)` from `@cms/queue`.
- `isConfigured = enabled && apiKeyEncrypted?.length > 0` (and, for our use, a `model` present —
  enforce in the chat route, not the config route).

### 2.3 Admin-readable status route (gap #2 fix)

Add to the chat route file (`ai-chat.ts`), gated `requireAdminRole('admin')`:

```
GET /api/admin/ai/status  ->  { enabled: boolean, configured: boolean }
```

Reads the same row via `tenantFilter`, returns **only** the two booleans (no provider, model, key,
or base URL). This is what the floating panel polls to decide whether to show itself.

### 2.4 Admin API client — `apps/admin/src/api/ai-settings.ts`

Clone `monitoring-settings.ts` client: `aiSettingsApi.get()` / `.update(input)` against
`/admin/settings/ai`, with `AiSettings` (response) and `AiSettingsInput` (partial, nullable) types.

### 2.5 Vue tab — `apps/admin/src/pages/InfrastructureSettings.vue`

Clone the Monitoring tab exactly:
- `type TabKey` add `'ai'`; add a subnav button + status dot + status-card row.
- Refs: `aiEnabled`, `aiProvider`, `aiModel`, `aiBaseUrl`, `aiApiKey`, `aiConfigured`, plus
  `origApiKey` (dirty-tracking — only send `apiKey` if changed) and `showApiKey`.
- `PROVIDER_OPTIONS`: `— Not set —`, `OpenAI`, `Anthropic`, `Google`, `Custom / Local`. Selecting one
  may pre-fill `aiBaseUrl` with that provider's OpenAI-compatible base URL (editable).
- `loadAi()` in `onMounted`; `saveAi()` builds `AiSettingsInput`; status chip `Active` / `Off`.
- Fields: **Enable** toggle (master switch), **Provider** select, **Model** free-text input,
  **API Key** masked password input (with show/hide), **Base URL** optional input.
- Per-setting help (what each field is, where to get a key, example base URLs) goes in the **help
  drawer** (`helpContent.ts`, keyed by the Infrastructure route) per the established convention —
  keep `.form-hint` to one short sentence each.

---

## 3 · Chat route + tool-loop spec

### 3.1 Auth & gating — `POST /api/admin/ai/chat`

- `addHook('preHandler', requireAdminAuth)` then `requireAdminRole('admin')` (admin + super_admin).
- Load the `ai_settings` row (`tenantFilter`). **Refuse** (`409`/`403` JSON) if `!enabled`, no key, or
  no model. Decrypt the key at call time with `decryptWebhookSecret(row.apiKeyEncrypted)`; never log it.
- Runs **as the logged-in user** — capture `request.headers.cookie` to forward into tool dispatch.

### 3.2 Provider abstraction — OpenAI-compatible client (`lib/ai/openai-compat-client.ts`)

Thin hand-rolled `fetch` client; **no SDK**. One code path:

```
POST `${baseUrl}/chat/completions`
Headers: Authorization: Bearer <key>   (Content-Type: application/json)
Body: { model, messages, tools, tool_choice: 'auto', stream: true }
```

- `tools` = OpenAI function-calling shape: `[{ type:'function', function:{ name, description, parameters }}]`
  where `parameters` is JSON Schema (we keep tool input schemas as JSON Schema, derived from the same
  Zod shapes the endpoints already use where practical).
- **Stream parsing:** read SSE `data:` lines; accumulate `choices[0].delta.content` (assistant text)
  and `choices[0].delta.tool_calls[]` fragments (concatenate `function.arguments` **by index**). Stop
  a turn on `finish_reason` (`'stop'` → done, `'tool_calls'` → dispatch then loop).
- `provider` only chooses the default `baseUrl`; the wire format is identical for all.

### 3.3 The manual loop — `lib/ai/chat-loop.ts`

```
messages = [systemPrompt, ...history, userMessage]
loop (bounded, e.g. max 8 tool rounds):
  stream a completion (3.2), forwarding text deltas to the SSE response as they arrive
  if finish_reason == 'stop': break
  if finish_reason == 'tool_calls':
    for each tool_call:
      emit a "tool start" SSE event (UI status chip)
      result = dispatchTool(call.name, JSON.parse(call.arguments), sessionCookie)   // §4
      emit a "tool end" SSE event (ok/err + short summary)
      push { role:'tool', tool_call_id: call.id, content: JSON.stringify(result) }
    continue loop
```

- **Manual** (not an auto-runner) so we own advisory gating and custom audit annotation. (Audit on
  the *underlying* mutation is automatic via the endpoint; we additionally tag chat-initiated calls —
  see §4.4.)
- **System prompt** seeds the assistant with: who it is, the active site context (a compact
  `describe_cms` snapshot or instruction to call it), the executory-vs-advisory rules, and the
  static-page conflict-free-CSS rules (so AI-authored static pages follow §6).

### 3.4 Streaming to the panel (SSE over POST)

Respond with `text/event-stream`; emit typed frames:
- `token` — assistant text delta (panel appends + re-renders MD incrementally)
- `tool` — `{ phase:'start'|'end', name, ok?, summary? }` (status chips)
- `done` / `error` — terminal.

Client consumes via `fetch('/api/admin/ai/chat', { method:'POST', body, credentials:'include' })`
then `res.body.getReader()` + a small SSE frame parser.

---

## 4 · v1 tool list

### 4.1 Tool registry shape

```ts
interface AiTool {
  name: string;
  description: string;
  parameters: JsonSchema;                 // OpenAI 'function.parameters'
  mode: 'executory' | 'advisory';
  // executory: { method, urlFor(args) }  -> dispatched via fastify.inject (§4.3)
  // advisory:  handler(args) -> returns guidance payload, NEVER mutates
}
```

### 4.2 Executory tools → exact endpoints

All executory tools are dispatched via `fastify.inject` **with the forwarded session cookie**, so
they re-run the real preHandler chain (auth + role + tenant scope + Zod + audit). The chat is admin+,
which satisfies every endpoint below (all are admin+ or lower).

| Tool | Method + path | Endpoint role | Notes |
|---|---|---|---|
| `list_content` | `GET /api/admin/content` | any auth | filters: status/type/author/q |
| `get_content` | `GET /api/admin/content/:id` | any auth | |
| `create_content` | `POST /api/admin/content` | author+ | draft |
| `update_content` | `PATCH /api/admin/content/:id` | editor+ | |
| `transition_content` | `POST /api/admin/content/:id/transitions` | editor+ | draft→…→published |
| `list_content_types` | `GET /api/admin/content-types` | any auth | |
| `get_content_type` | `GET /api/admin/content-types/:id` | any auth | |
| `create_content_type` | `POST /api/admin/content-types` | admin+ | reserved-slug guard server-side |
| `update_content_type` | `PATCH /api/admin/content-types/:id` | admin+ | slug/field locks server-side |
| `list_taxonomies` | `GET /api/admin/taxonomies` | any auth | |
| `create_taxonomy` | `POST /api/admin/taxonomies` | admin+ | |
| `update_taxonomy` | `PATCH /api/admin/taxonomies/:id` | admin+ | |
| `list_terms` | `GET /api/admin/taxonomies/:taxonomyId/terms` | any auth | |
| `create_term` | `POST /api/admin/taxonomies/:taxonomyId/terms` | editor+ | |
| `update_term` | `PATCH /api/admin/taxonomies/:taxonomyId/terms/:termId` | editor+ | |
| `list_pages` | `GET /api/admin/pages` | any auth | static + dynamic |
| `get_page` | `GET /api/admin/pages/:id` | any auth | **reads dynamic pages too** |
| `list_page_layouts` | `GET /api/admin/pages/layouts` | any auth | for static page layout choice |
| `create_static_page` | `POST /api/admin/pages` (`type:'static'`) | admin+ | HTML/CSS; follow §6 CSS rules |
| `update_static_page` | `PATCH /api/admin/pages/:id` | admin+ | static only in v1 |
| `transition_page` | `POST /api/admin/pages/:id/transitions` | admin+ | |
| `preview_static_page` | `POST /api/admin/pages/preview-static` | any auth | no DB write |
| `list_menus` | `GET /api/admin/menus` | any auth | |
| `get_menu` | `GET /api/admin/menus/:id` | any auth | |
| `create_menu` | `POST /api/admin/menus` | admin+ | |
| `update_menu` | `PATCH /api/admin/menus/:id` | admin+ | |
| `create_menu_item` | `POST /api/admin/menus/:menuId/items` | admin+ | |
| `update_menu_item` | `PATCH /api/admin/menus/:menuId/items/:itemId` | admin+ | |
| `reorder_menu_items` | `PUT /api/admin/menus/:menuId/items/order` | admin+ | |
| `list_blocks` | `GET /api/admin/blocks` | any auth | code manifest (read-only) |
| `describe_cms` | composed (see §4.5) | any auth | the "knows the CMS" tool |

### 4.3 Dispatch mechanism — `fastify.inject`

```ts
const res = await fastify.inject({
  method, url,
  headers: { cookie: sessionCookie, 'content-type': 'application/json' },
  payload,
});
return { status: res.statusCode, body: res.json?.() ?? res.body };
```

This is the keystone: tools literally hit the same routes as the UI, so RBAC, tenant scoping, Zod
validation, state-machine guards, cache invalidation, and **audit logging** all apply unchanged. A
403 (e.g. an endpoint needing a higher role than the chat user has) is returned to the model as a
tool result, which it surfaces to the user — it cannot escalate.

### 4.4 Advisory tools (return guidance, never mutate)

| Tool | Covers | Behavior |
|---|---|---|
| `advise_settings_change` | infrastructure / site settings (incl. the AI tab itself) | returns the relevant settings location + steps; no write |
| `advise_user_or_role_change` | users & roles (no admin endpoints exist) | returns steps; no write |
| `advise_delete` | any delete (content/page/type/taxonomy/term/menu/item) | returns where + how to delete safely; no write |
| `advise_dynamic_page` | dynamic-page authoring (deferred to v1.1) | explains using the block editor; may call `get_page`/`list_blocks` to ground the advice |

Advisory handlers may **read** (call read-only executory tools) to ground their answer, but perform
no mutation. Their result tells the model "present these steps as Markdown; do not claim you did it."

### 4.5 `describe_cms` (gap #1 fix)

Composes a compact Markdown/JSON description from admin-readable GETs — `list_content_types`,
`list_taxonomies`, `list_menus`, `list_blocks`, and site settings — **not** `docs.ts` (super-admin +
POST). Used to seed the system prompt and as an on-demand tool.

### 4.6 Gate logic (executory vs advisory)

- **Resource + verb rule:** create/update/transition/reorder/read on content, content-types,
  taxonomies/terms, **static** pages, and menus → **executory** (wrapped). **Deletes** on any resource,
  **settings/infrastructure**, **users/roles**, and **dynamic-page authoring** → **advisory** (no
  wrapper registered).
- The boundary is encoded structurally: advisory items have **no executory tool**, so the model
  *cannot* perform them even if it tries — its only path is the `advise_*` tool. Belt-and-suspenders:
  the system prompt states the same boundary.
- RBAC is still enforced underneath via `fastify.inject` (defense in depth) even though the chat
  role gate already restricts callers to admin+.

---

## 5 · Chat UI spec

- **Mount point:** add `<AiAssistant />` to `apps/admin/src/App.vue` alongside `HelpDrawer` etc.
  (global, above the router view).
- **State:** `apps/admin/src/composables/useAiChat.ts` — a module-scope singleton (mirrors
  `useHelp.ts`): `isOpen`, `messages`, `streaming`, `open/close/toggle`, `send(text)`.
- **Gating:** render only when `auth.hasRole('admin')` **and** `aiStatus.enabled` is true. On mount,
  call `GET /api/admin/ai/status`; hide entirely if disabled/unconfigured. (Non-super admins use the
  status route, never the super-admin config route.)
- **Launcher:** a bottom-right floating bubble; panel slides in (reuse HelpDrawer transition/z-index
  conventions, sit below modals).
- **Markdown rendering:** **reuse `MarkdownRenderer.vue`** (markdown-it + DOMPurify + highlight.js —
  all already deps; `.md-prose` styles exist). Re-render the accumulating assistant buffer as tokens
  arrive. Sanitize every render (DOMPurify) — non-negotiable since the model can emit arbitrary HTML.
  **Smoothness matters** (flagged in review): append-only buffer, coalesce re-renders to one per
  animation frame (`requestAnimationFrame`) or a ~30–50 ms debounce — fast enough to feel live, slow
  enough to avoid flicker and avoid re-highlighting code on every token. Tune by feel during 1d.
- **Tool chips:** render `tool` frames as inline status chips ("Creating content type…", "✓ done" /
  "✗ 403"). On **advisory** turns, the assistant simply renders Markdown steps (no chip / a "guidance"
  chip).
- **Transport:** `apps/admin/src/api/ai-chat.ts` posts to `/api/admin/ai/chat` with
  `credentials:'include'` and streams via `res.body.getReader()`.

---

## 6 · Static-page CSS docs (conflict-free) — lives in `04-page-templates.md`

**Problem:** `PageView.vue` injects static-page CSS **globally** (`<Head><Style>…`), so bare selectors
leak into the theme's header/footer/chrome. (Raw HTML/CSS is intentionally unsanitized — trusted
single-publisher model — so we *document*, not sanitize.)

**Rules to document (add to the existing static-page section of `04-page-templates.md`):**
- Wrap all page markup in one unique container class, e.g. `.sp-<slug>`, and **scope every rule
  under it**.
- **Never** use bare global selectors: `body`, `html`, `h1`–`h6`, `a`, `p`, `img`, `*`, or theme
  utility class names.
- Prefer class/attribute/descendant selectors; avoid `!important`; put analytics/`<script>` in the
  **Extra `<head>`** field (inline `<script>` in the body never executes).

**Worked before/after example (goes in the Hub doc):**

```html
<!-- ❌ BEFORE — leaks into the whole site -->
<style>
  body { background: #f5f5f5; }     /* repaints every page */
  h1   { color: #b00; }             /* recolors theme headings */
  a    { text-decoration: underline; }
</style>
<h1>Our Mission</h1>
<p>…</p>

<!-- ✅ AFTER — scoped under one container -->
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

- **Drawer pointer:** in `helpContent.ts`, the static-page editor route entry gets ONE short line +
  link: *"Scope all CSS under a unique container class so it doesn't affect the rest of the site —
  see the Page Templates guide for a worked example."*
- The chat **system prompt** embeds these same rules so AI-authored static pages comply by default.

---

## 7 · Help drawer vs Documentation Hub coexistence

**Division of responsibility (make explicit; both stay):**

| | Help drawer (`helpContent.ts`) | Documentation Hub (`docs/*.md`) |
|---|---|---|
| Keyed by | `route.name` | file order / frontmatter |
| Audience | operators, in-context | developers / theme authors |
| Length | short: "what this page does / common tasks / one tip" + per-setting how-to for Infrastructure | long-form guides + worked examples |
| Static-page CSS | one-line rule + pointer | full rules + before/after example |

**De-dup audit (1f):** scan `helpContent.ts` against `docs/*.md` for overlap. Specifically confirm the
static-page CSS guidance exists in exactly **one** deep place (the Hub) with only a pointer in the
drawer; trim any long CSS explanation that may already sit in the drawer. No code changes beyond these
two files; record the division in a short comment block at the top of `helpContent.ts`.

> Note: per the established convention, *per-setting* Infrastructure help (where to get an API key,
> example base URLs) belongs in the **drawer**; the long-form CSS *guide* belongs in the **Hub**. These
> do not conflict — different content types.

---

## 8 · Acceptance criteria / Definition of Done

- [ ] `ai_settings` table created via generated migration `0025_*` (verified as the next free number);
      `@cms/db` rebuilt; API sees it.
- [ ] `GET/PATCH /api/admin/settings/ai` work, super-admin-only; key encrypted at rest; **GET never
      returns the plaintext key** (returns `MASK`/`''`); mask-aware PATCH keeps unchanged key intact.
- [ ] `GET /api/admin/ai/status` returns `{ enabled, configured }` to admin+ with no secrets.
- [ ] AI Assistant tab renders in Infrastructure settings, matches the Monitoring tab visually, with
      a working status chip (Active/Off) and provider→base-URL preset.
- [ ] `POST /api/admin/ai/chat` streams Markdown token-by-token; refuses when disabled/unconfigured.
- [ ] Provider-agnostic: switching base URL+model+key to another OpenAI-compatible endpoint works with
      **no code change**.
- [ ] Executory tools mutate via `fastify.inject` and produce **audit-log rows** with the real actor.
- [ ] Advisory requests (settings, users/roles, deletes, dynamic-page authoring) return Markdown steps
      and perform **no mutation** (verified via audit log + DB).
- [ ] An `admin` (non-super) can use the chat and successfully create content / a content type / a
      static page / a menu, and is correctly refused (graceful message) on anything needing more.
- [ ] Chat panel hidden for `editor` and below, and hidden when the master toggle is off.
- [ ] Replies render full Markdown (headings/lists/code/tables) sanitized via DOMPurify.
- [ ] Static-page CSS worked example present in `04-page-templates.md`; one-line pointer in the drawer;
      AI-authored static pages emit scoped CSS.
- [ ] Help/Docs division documented; no duplicated static-page CSS guidance.
- [ ] `pnpm lint` clean; single-quote style; no `prettier --write`.

---

## 9 · Risks & what stays human-judgment

- **Provider-specific tool-calling quirks (primary risk).** Even within "OpenAI-compatible," some
  endpoints differ: Anthropic/Google compat layers may not stream `tool_calls` argument fragments
  identically, may not support `tool_choice:'auto'`, or may cap parallel tool calls. **Mitigation:**
  test against ≥2 endpoints; keep the stream parser tolerant (handle whole-object tool_calls and
  fragmented ones); document "known-good" endpoints; verify exact OpenAI-compat base URLs at build time.
- **Hallucinated tool arguments.** The model may invent IDs/slugs. Mitigation: read-before-write
  guidance in the system prompt; endpoints already Zod-validate and 404/409 on bad input — surfaced
  back to the model.
- **Long/looping tool chains.** Bound the loop (max rounds) and total tokens; emit a "stopped early"
  message if hit.
- **Secret handling.** Decrypt only at call time; never log the key or echo it in errors; status route
  must not leak provider/model.
- **Static-page CSS collisions** remain possible if the operator overrides AI output by hand — docs +
  system prompt reduce but can't eliminate (by-design unsanitized model).
- **Human-judgment (stays advisory in v1):** anything touching settings/infrastructure, users/roles,
  and destructive deletes; whether to publish vs leave in review; dynamic-page block composition.

**Build watch-items (flagged in review):**
- **Token cost of ~30 tool definitions per request.** Every chat turn ships all tool schemas to the
  model — fine for modern models, but it's a non-trivial per-request token cost. Keep tool
  descriptions/schemas tight; **monitor cost per conversation once live**; if it grows, curate or tier
  the exposed tool set (e.g. expose a smaller default set + an "advanced" group) rather than always
  sending all ~30. Not a v1 blocker, just a thing to track.
- **Migration number must be re-verified at build time.** Confirmed latest is `0024_*` →
  new migration is `0025_*`, but anyone landing a migration before this ships shifts the number;
  always check `packages/db/migrations` + `meta/_journal.json` before `db:generate`.
- **Streaming Markdown must feel smooth, not janky.** Covered in §5 — too-slow re-render feels broken,
  too-fast flickers and re-highlights code constantly. Treat the rAF/debounce tuning as a real (small)
  UX task in 1d, not an afterthought.

---

## 10 · Effort estimate

| Phase | Estimate |
|---|---|
| 1a — config tab + status route (clone monitoring) | 1.0–1.5 d |
| 1b — chat route + OpenAI-compat client + streaming + loop scaffold | 1.5–2.0 d |
| 1c — tool layer (registry, inject dispatch, ~30 tools, advisory, describe_cms) | 2.0–3.0 d |
| 1d — floating panel + composable + gating + incremental MD streaming + chips | 1.5–2.0 d |
| 1e — static-page CSS docs (example + pointer) | 0.5 d |
| 1f — help/docs division + de-dup audit | 0.5 d |
| integration, multi-endpoint testing, polish | 1.0–2.0 d |
| **Total** | **~8–11 days** |

---

## Verification (end-to-end)

1. **DB/migration:** verify latest is `0024_*` → `pnpm db:generate` → review `0025_*.sql` →
   `pnpm db:migrate` → `pnpm --filter @cms/db build`. Confirm the table exists (psql `\d ai_settings`).
2. **Config tab:** run admin (`:5173`) + API; log in as the standing super_admin; open Infrastructure →
   AI Assistant; save provider+model+key+baseURL; reload → key shows masked, status chip = Active.
   Confirm DB stores `api_key_encrypted` as bytea and GET response carries `MASK`, never plaintext.
3. **Status gate:** with the toggle off, confirm `GET /api/admin/ai/status` → `{enabled:false}` and the
   panel is hidden; toggle on → panel appears.
4. **Chat happy path (executory):** ask "create a content type called Press Release with a title and
   body field," then "create a draft titled Hello," then "add a top-nav menu item linking to /about."
   Verify rows created **and** `audit_log` entries with the real actor; watch tokens stream + tool
   chips.
5. **Advisory path:** ask "delete the Press Release type" and "change Bob to editor" and "turn on
   CORS" → assistant returns Markdown steps, performs **no** mutation (check audit log + DB unchanged).
6. **Role gate:** log in as an `editor` → panel hidden; as `admin` → panel visible, executory works,
   and a super-admin-only action is gracefully refused.
7. **Provider-agnostic:** point base URL+model+key at a second OpenAI-compatible endpoint; repeat step
   4 with **no code change**.
8. **Static-page CSS:** ask the assistant to "make an About page" → confirm generated CSS is scoped
   under a unique container class (no bare `body`/`h1`); preview on the public site shows no theme
   chrome bleed. Confirm `04-page-templates.md` has the worked example and the drawer has the pointer.
9. **MD render/sanitize:** ask for a reply containing a table + code block + a link → renders correctly
   via `.md-prose`; confirm any injected `<script>`/`onerror` is stripped by DOMPurify.
10. **Gate:** `pnpm lint` clean.

> Use the `preview_*` tools (admin at `:5173`) for UI verification per the standard workflow; do not
> edit API src during an e2e run.
