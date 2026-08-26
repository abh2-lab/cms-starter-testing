# Phase 2 — AI Theme-Authoring Kit — Implementation Plan

> **Status:** Approved plan. Phase 2 produces *code-shipped* blocks/templates/parts
> + fixtures that feed the existing theme engine. No new admin UI. This document is
> the source-of-truth plan; it lives in `docs/` (which is `export-ignore`d, so it
> stays out of the publisher export).

---

## Context — why this is being built

The product already ships a complete block/template/part theme engine plus an
FSE-style runtime override layer (`theme_overrides`, draft/publish,
`base_version`). What it does **not** have is a way to turn a **mock HTML
design into a working theme fast**. Today that means a developer hand-writing
the two halves of every block (server loader in `@cms/blocks`, Vue renderer in
the theme), wiring two registries by hand, and remembering a 5-step recipe whose
failure modes are silent (key mismatch → blank render; forgot
`pnpm --filter @cms/blocks build` → block invisible in admin).

**Phase 2 makes that ~80–90% autonomous and cross-client.** When a publishing
company opens the exported repo in *any* coding assistant (Claude Code, Cursor,
Windsurf, Agent SDK), the assistant reads a mock HTML file and produces blocks,
templates/parts, and seed fixtures — with a developer doing only final QA. The
capability ships as **files inside the product export**, not a server:

1. **Knowledge** — an agent-facing onboarding/orchestration doc (the "skill").
2. **Generation** — `gen:block` / `gen:template` CLIs that automate the manual
   recipe so keys can't drift.
3. **Guardrail** — `verify:theme` + a containment fence (import-boundary lint,
   diff-scope guard, build-time gate) so broken or out-of-scope code can't reach
   the live site.

Phase 2 **feeds** the existing engine; it builds **no new admin UI**. Generated
code is what admins then customize at runtime through the FSE override layer.

### Settled decisions (from the brief + clarifying answers)

| Decision | Choice |
| --- | --- |
| MCP? | **No.** Docs/skill + deterministic `pnpm` CLIs only. Keep MCP-wrappable later. |
| First-boot content seed | **Documented one-shot CLI** (`docker compose run --rm api … seed:fixtures`). Reuse the existing idempotent, tenant-scoped seeder; no new runtime service. **Requires the api-image fixtures fix (Defect A).** |
| Onboarding files in export | **Commit `AGENTS.md` at root** (ships natively) **+ generate `CLAUDE.md`** (and thin Cursor/Windsurf pointers) into the zip via `export-starter.mjs`. |
| Devcontainer | **No** — rely on STARTER-README hybrid-dev instructions + the onboarding doc. |
| Screenshot-diff (2f) | **Deferred** — documented as future work; not built this phase. |

---

## Contradictions found in the code (must be reconciled by the plan)

1. **The onboarding kit would be stripped from the export.**
   `.gitattributes` `export-ignore`s `docs/`, `.claude/`, **and `CLAUDE.md`**.
   So a `.claude/skills/*` "skill", a `docs/*` onboarding doc, or a root
   `CLAUDE.md` pointer would **not** ship in `cms-starter.zip`.
   → **Resolution:** the onboarding doc + cross-assistant pointer ship as root
   **`AGENTS.md`** (not in the ignore list). `export-starter.mjs` additionally
   **generates** publisher-facing per-client pointers into the staging dir (same
   pattern it already uses for `.env`/`STARTER-README.md`,
   `scripts/export-starter.mjs:379-380`). A `.claude/commands/*` slash command
   for the *vendor's own* Claude Code is fine but is dev-only and won't ship.

2. **The Vue registry is deliberately hand-maintained — `gen` changes that.**
   `apps/web/themes/default/app/composables/useBlockRegistry.ts:71-74` states the
   static map is "not generated **on purpose**" but anticipates exactly this
   work: *"A future build-time check can compare this map against the manifest if
   drift becomes a concern."*
   → **Resolution:** `verify:theme`'s registry-coherence check **is** that
   blessed build-time check. `gen` edits the map deterministically via
   **anchor-comment sentinels** (added once in 2a) so it stays small,
   human-readable, and type-checked; eager `import` by default, `defineAsyncComponent`
   only with `--lazy` (for tiptap-heavy blocks like `post-content`/`custom-field`).

3. **`.github/` is export-ignored — a publisher gets no CI workflow.**
   → **Resolution:** the gate that "can never reach live" runs **inside the
   Docker builder stage** (`RUN pnpm verify:theme:structure`) — Dockerfiles ship.
   The import-boundary fence lives in **`pnpm lint`** (eslint ships). A `.github`
   workflow + optional pre-push hook serve the *vendor* repo only.

4. **Prettier is present but must not be used.** Root has `format`/`format:check`
   scripts, but the enforced gate is **eslint only** (no repo Prettier config).
   → Generated code must be **eslint-clean and single-quoted**; `gen`/`verify`
   never run `prettier --write`.

---

## Build-pipeline defects this phase must fix (confirmed against the Dockerfiles)

These are **prerequisites** — the chosen seed path and the build-time gate both
sit directly on top of them.

### Defect A — `seed:fixtures` can't run in the deployed image
The api runner stage copies `dist`, `src`, `scripts` but **not** the fixtures dir
(`apps/api/Dockerfile:59-72`). Authored content lives as JSON at
`apps/api/fixtures/<name>/*.json` (confirmed: `example/`, `decode/`,
`sample-cpt/`). So the chosen one-shot `seed:fixtures` would fail "dir not found"
on Coolify.
→ **Fix (chosen):** add to the runner stage
`COPY --from=builder /repo/apps/api/fixtures apps/api/fixtures`.
We COPY fixtures (not switch to the code-based `seed:examples`, line 15 of
`apps/api/package.json`) because **AI-authored starter content ships as JSON
fixtures** — `seed:examples` only carries the built-in demo and can't deliver a
publisher's authored set.

### Defect B — `packages/blocks` (and the new `packages/theme-kit`) are absent from the image deps stage
Both Dockerfiles' deps stage enumerate package.jsons and **omit
`packages/blocks`** (`apps/api/Dockerfile:18-29`; `apps/web/Dockerfile:24-35`),
though `@cms/blocks` is a `workspace:*` dep of the API. Likely a latent
`--frozen-lockfile` build break; load-bearing here because the web-image build
gate (2c) imports `@cms/blocks` and runs `@cms/theme-kit`.
→ **Fix:** add `COPY packages/blocks/package.json packages/blocks/` and
`COPY packages/theme-kit/package.json packages/theme-kit/` to **both** deps
stages. **Verify with a real `docker build`** (Step 0).

### Defect C — the full `verify:theme` can't run in the web builder
The web builder copies only `packages/` + `apps/web/` (`apps/web/Dockerfile:57-58`),
**not `apps/api/`** — so fixture validation (which needs
`apps/api/src/services/fixture-loader/schemas.ts`) can't execute there.
→ **Fix:** **split the gate.** Theme-*structure* checks (metas,
registry-coherence, `@cms/blocks` build, typecheck, render-smoke) gate the web
image and need only `packages/` + `apps/web/`. *Content* checks (fixture
validation + block↔fixture binding) run in CI/local/pre-seed where `apps/api` is
present. Cleaner layering anyway: fixtures are DB-seeded content, not web-image
artifacts.

---

## 1. Phased breakdown

Sequencing: **Step 0 → 2a → 2b → 2c** are the core. **2d/2e** package and document
(and carry Defects A/B). **2f** is deferred.

### Step 0 — Pre-flight: verify the image build (do FIRST, ~10 min)
Before sinking days into 2a, run `docker build -f apps/api/Dockerfile .` and
`docker build -f apps/web/Dockerfile .` once — the **only unverified assumption in
this plan**. If they fail *only* on missing `packages/blocks`, the one-line `COPY`
(Defect B) is sufficient and 2c/2e proceed as scoped. If *more* surfaces (the
Dockerfiles may be stale since the blocks/theme-engine refactors), expand 2c/2e
scope **now** — those phases sit directly on a working image build, so a bigger
Docker problem is far cheaper to discover here than mid-build. (Resolves
open-decision #7.)

### 2a — Knowledge + Generation
- **Create** `packages/theme-kit/` workspace package (`@cms/theme-kit`): a TS CLI
  (`gen`, `verify` subcommands) run via `tsx`; depends on `@cms/blocks` for
  `BlockMetaSchema`/`TemplateMetaSchema` + the registries. **Must NOT import
  `apps/api`** (keeps the structure gate runnable in the web builder).
- **Add anchor sentinels** (one-time) to `packages/blocks/src/registry.ts`,
  `packages/blocks/src/index.ts`, and the theme's `useBlockRegistry.ts` —
  `// <gen:blocks> … // </gen:blocks>` regions for deterministic, idempotent inserts.
- **Build** `gen:block` (§2) and `gen:template` (§2).
- **Write** root **`AGENTS.md`** — the onboarding/orchestration doc (§5). Add root
  `pnpm` scripts: `gen:block`, `gen:template`.
- **Register** `@cms/theme-kit` in `pnpm-workspace.yaml`.

### 2b — Verify gate
- **Build** the `verify` subcommand split into two scopes (§3): `verify:theme:structure`
  (theme-kit; no `apps/api` dep) and `verify:theme:content` (an `apps/api` script
  — fixtures live there). Root `verify:theme` runs both (local/CI); `--json` for
  the agent loop.

### 2c — Containment fence
- **Add** `no-restricted-imports` for `packages/blocks/src/**` in
  `eslint.config.mjs` (§4).
- **Add** diff-scope guard `scripts/check-theme-scope.mjs` (§4).
- **Wire** `RUN pnpm verify:theme:structure` into the web builder stage
  (`apps/web/Dockerfile`), **after** `COPY packages/`+`apps/web/` and before/around
  the nuxt build, so a broken theme fails `docker build` → Coolify deploy fails.
- **Apply Defect B fix** (both deps stages) so the gate can install/run.
- **Add** vendor-only `.github/workflows/theme-verify.yml` (lint + full
  `verify:theme` + scope guard) — dev repo only (won't ship).

### 2d — Export & onboarding kit
- **Add** a `dev:services` root script (or a compose `services` profile) that boots
  **only** the backing services (Postgres/PgBouncer/Dragonfly/Meili/MinIO) for the
  hybrid author loop — one command instead of `docker compose up` + `stop api admin
  web worker` (which "fight ports"). Document in `AGENTS.md` + `STARTER-README.md`.
- **Edit** `scripts/export-starter.mjs` to generate `CLAUDE.md` + thin
  Cursor/Windsurf pointer files (all "see `AGENTS.md`") and extend
  `STARTER-README.md` with an "AI theme authoring" section + the authoring≠runtime
  boundary + "point your assistant at `AGENTS.md`".
- **Confirm** `packages/theme-kit/`, `AGENTS.md`, the 8 reference docs
  (`apps/admin/src/docs/`), and `apps/api/fixtures/**` survive export; theme-kit
  `*.test.ts` correctly stripped.

### 2e — Deploy + seed pipeline
- **Apply Defect A fix** (api runner copies fixtures).
- **Document** the post-deploy one-shot
  `docker compose run --rm api pnpm --filter @cms/api seed:fixtures -- <name> --tenant=<slug>`
  and verify it against a real image.
- Add `apps/api/fixtures/**` to the diff-scope allowlist (authored fixtures live there).

### 2f — Screenshot-diff — **DEFERRED**
Documented in `AGENTS.md` as future work (Playwright baseline per template).

---

## 2. `gen:block` / `gen:template` spec

Grounded in `packages/blocks/src/types.ts` (`BlockMetaSchema`,
`BlockKind = standalone|field|container|box`, `TemplateMeta`, `TemplateRole`),
the example blocks (`hero`, `post-title`, `group`, `post`/`query-loop`), and
`registry.ts`.

### `gen:block`
**Inputs:** `--key` (`^[a-z][a-z0-9-]*$`), `--kind`, `--label`, `--category`,
`--description?`, `--icon?`, `--fields`/`--options` (BlockField[]: snake_case keys,
type ∈ `BLOCK_FIELD_TYPES`), `--lazy?`.

**Files written / edited:**

| Half | Path | Content |
| --- | --- | --- |
| Server | `packages/blocks/src/blocks/<key>.ts` | `export const <camelKey>: Block<Fields, Options>` with typed interfaces, `meta`, kind-appropriate `load()` stub (+ `resolveBoxes()` for `box`). |
| Server registry | `packages/blocks/src/registry.ts` | import + `[<camelKey>.meta.key, <camelKey>]` inside the anchor. |
| Barrel | `packages/blocks/src/index.ts` | re-export (if the barrel lists blocks). |
| Render | `apps/web/themes/default/app/components/blocks/Block<PascalKey>.vue` | `<script setup lang="ts">` with `defineProps<{ fields; options; data }>()` mirroring `load()`; minimal template. |
| Vue registry | `…/composables/useBlockRegistry.ts` | import + `'<key>': Block<PascalKey> as Component` inside the anchor (eager; `defineAsyncComponent` if `--lazy`). |

**Kind-specific stubs:** `standalone` → `load` fetches + returns data;
`field` → `load(ctx)` reads `ctx.box?.content.…`; `container` → `load()` returns
`null`, `.vue` renders `<slot/>`; `box` → `load()` returns `null` +
`resolveBoxes()` returns `PostBox[]`, `.vue` renders `<slot/>`.

**Registration / rebuild / idempotency:** anchor-bounded, sorted inserts;
re-running the same `--key` updates in place (idempotent). Emits eslint-clean,
single-quoted code; runs `eslint --fix` on touched files. Finishes by running
`pnpm --filter @cms/blocks build` so admin/api see the new block.

### `gen:template`
**Inputs:** `--key`, `--name`, `--description?`, `--role?`, `--blocks` (recursive
`TemplateBlock[]`), `--version?` (default `1`).

**Targets (override-compatible by construction):**
- **Page template** (no role) → `templates/<key>.ts` → `templateRegistry`.
- **Part** (`role ∈ header|footer|sidebar`) → `parts/<key>.ts` → **`partRegistry`**.
- **Role/system template** → file + registry entry, with a
  `// TODO(human): wire selection in resolve-template.ts` marker (selection logic
  is the one place conditions live — **human checkpoint**, not auto-wired).
- Sets `version: 1`; references only `block_key`s present in `blockRegistry`
  (validated before write); sets correct `role` for the FSE override engine.

### Fixtures (companion output)
`gen` (or the agent) writes the authored sample content as JSON fixtures under
**`apps/api/fixtures/<name>/*.json`** (confirmed path; same shape as `example/`,
`decode/`, `sample-cpt/`), validated against the fixture-loader schemas. This is
what `seed:fixtures` later loads on deploy.

**Validation:** every generated meta is parsed through `BlockMetaSchema` /
`TemplateMetaSchema` before write — generation that wouldn't pass `verify` fails fast.

---

## 3. `verify:theme` spec (split into two scopes — Defect C)

Serverless, deterministic, ordered cheapest-first. `--json` for the agent loop.

### `verify:theme:structure` — gates the web image (theme-kit; needs only `packages/` + `apps/web/`)

| # | Assertion | Catches |
| --- | --- | --- |
| 1 | **Zod-validate metas** — blocks via `BlockMetaSchema`; templates/parts via `TemplateMetaSchema`; field keys snake_case, types valid, select has options, number min≤max. | malformed metas |
| 2 | **Registry coherence (both directions)** — `listBlockMetas()` keys vs `BLOCK_REGISTRY` keys; every server key ↔ a Vue component (+ file exists); every template/part `block_key` (recursive) ∈ both registries; parts only use `header|footer|sidebar`. | **key mismatch → blank render** (the #1 silent gotcha) |
| 3 | **`@cms/blocks` build** — `pnpm --filter @cms/blocks build`. | **forgot to rebuild** → stale `dist` |
| 4 | **Typecheck** — `@cms/blocks` + theme (`vue-tsc`); `.vue` `data` props vs `load()` output. | typed prop/loader drift |
| 5 | **Render-smoke (serverless, structural only)** — stub `BlockLoadContext`; call each block's `load()`/`resolveBoxes()` with meta defaults; assert no-throw + shape; assert every template/part key resolves in both registries. | loaders that throw; unresolved keys — without a server |

> **Render-smoke ≠ render.** It exercises `load()`/`resolveBoxes()`; it does **not**
> mount the `.vue`. A component that throws on `data.foo` at render time still
> passes (vue-tsc catches *typed* drift, not runtime template errors). "Structure
> green" is a real but partial guarantee — actual rendering is proven by the
> hybrid preview + human QA step (§7).

### `verify:theme:content` — runs in CI/local/pre-seed (an `apps/api` script; fixtures live there)

| # | Assertion | Catches |
| --- | --- | --- |
| 6 | **Zod-validate fixtures** — each set under `apps/api/fixtures/<name>/` via the fixture-loader schemas. | bad sample content before any seed |
| 7 | **Block↔fixture binding** — every `content_type_slug` / `category_slug` / taxonomy referenced in template & block `default_options` exists in the authored fixtures. | a template that passes structure-smoke (stub ctx) but **renders empty** because the bound CPT/term isn't seeded |

Implemented as `apps/api/scripts/verify-fixtures.ts` (`pnpm --filter @cms/api
verify:fixtures`) so theme-kit stays free of `apps/api` imports. Root
`verify:theme` orchestrates structure + content for local/CI.

**Pass/fail:** exit 0 only if all checks in scope pass. On failure: exit 1 +
per-check `{ check, status, key?, file?, message, fix }` (text + `--json`) so the
agent self-corrects and loops.

---

## 4. Containment spec

Runnable checks, reconciled with the **main-branch** working style — no mandatory
branch/PR. Three layers:

1. **Import-boundary lint** (always-on via `pnpm lint`; eslint ships).
   New `eslint.config.mjs` object for `packages/blocks/src/**` forbidding
   `@cms/db`, `@cms/config`, `drizzle-orm`, `pg`, `fastify`, and relative climbs
   into `apps/` (via `no-restricted-imports` `patterns`). `zod` and `../types.js`
   stay allowed.

2. **Diff-scope guard** `scripts/check-theme-scope.mjs` — `git diff --name-only`
   vs a base; **fail if any changed path is outside** the allowed surface:
   - `packages/blocks/src/{blocks,templates,parts}/**`, `registry.ts`, `index.ts`
   - `apps/web/themes/default/app/components/blocks/**`
   - `apps/web/themes/default/app/composables/{useBlockRegistry,usePostTemplateRegistry}.ts`
   - **`apps/api/fixtures/**`** (authored content)
   Runs in vendor CI + optional local pre-push hook (needs a base ref → not in the Dockerfile).

3. **Build-time gate** — `RUN pnpm verify:theme:structure` in the web builder
   stage (+ Defect B deps fix so it installs). Broken theme → image build fails →
   Coolify deploy fails → live untouched. Builder already has the toolchain.

Vendor-only `.github/workflows/theme-verify.yml` runs lint + full `verify:theme`
+ scope guard on PRs (dev repo; export-ignored).

---

## 5. Export & onboarding kit

**Ships natively (not ignored):** `packages/theme-kit/`, the `gen:*`/`verify:*`
root scripts, the eslint fence, `scripts/check-theme-scope.mjs`, root
**`AGENTS.md`**, the 8 reference docs (`apps/admin/src/docs/`),
`apps/api/fixtures/**`, and the hybrid/author-mode compose
(`docker-compose.override.yml`).

**Generated into the zip by `export-starter.mjs`** (alongside `.env`/`STARTER-README.md`):
- **`CLAUDE.md`** — thin pointer ("AI theme authoring → see `AGENTS.md`").
- **Thin Cursor/Windsurf pointers** (e.g. `.cursor/rules/ai-authoring.md`,
  `.windsurfrules`) — each just points at `AGENTS.md`, because **cross-client
  reach can't rely on AGENTS.md alone**: Claude Code wants `CLAUDE.md`, Cursor/
  Windsurf have their own rules files, and AGENTS.md adoption is growing but not
  universal.
- `STARTER-README.md` gains an "AI theme authoring" section that also says
  "point your assistant at `AGENTS.md`".

**`AGENTS.md` (the skill) must state:**
- **The loop:** mock HTML → decompose → `gen:block`/`gen:template` → fill
  `load()` + `.vue` → author fixtures → `pnpm verify:theme` (loop until green) →
  preview in hybrid → **human QA**.
- **Command list:** `pnpm install`, `pnpm dev:services` (backing services only),
  `pnpm dev` (admin :5173 / web :3001 / api :3000), `pnpm gen:block`,
  `pnpm gen:template`, `pnpm --filter @cms/blocks build`, `pnpm verify:theme`,
  `pnpm --filter @cms/api seed:fixtures -- <name> --tenant=<slug>`.
- **Hard rules:** blocks are DB-free (`ctx` only); keys lowercase-dashed, match
  server↔Vue; rebuild `@cms/blocks` after edits; field/box/container blocks
  aren't standalone-previewable (422 — preview via a template); stay in the theme
  surface; never `prettier --write`; never edit api `src` during a running
  e2e/preview; **`verify:theme` green proves structure, not pixels — always
  preview before QA.**
- **The authoring ≠ runtime boundary (explicit):** authoring is **hybrid/dev**;
  runtime is **full Docker on Coolify with theme baked into images at build
  time** — **never author on the live container.**

---

## 6. Deploy + seed pipeline

Author in **hybrid** → `verify:theme` green → preview → human QA → **commit** →
build **Docker images** (theme baked in; `verify:theme:structure` gates the web
image; Defect B deps fix lets it run) → deploy to **Coolify** (`db-migrate`
one-shot; setup wizard creates tenant + super_admin) → **seed starter content**.

**Theme vs content split:**
- **Theme code** → baked into images (gated by the builder-stage structure check).
- **Starter content** (CPTs, taxonomies, sample pages via fixtures) → seeded into
  the deployed DB **after** first boot via the one-shot CLI:
  ```bash
  docker compose run --rm api \
    pnpm --filter @cms/api seed:fixtures -- <fixture-name> --tenant=<PUBLIC_TENANT_SLUG>
  ```
  **Depends on Defect A fix** (api runner must contain `apps/api/fixtures/`). The
  seeder is idempotent + tenant-scoped; `PUBLIC_TENANT_SLUG` must match the
  wizard-created tenant. Pre-seed, run `verify:theme:content` to catch
  binding/fixture errors before they hit the prod DB.

**Where the gate sits:** the web image **builder stage** (structure checks) —
before a runnable image exists — so broken theme code can never reach live.

---

## 7. End-to-end agent workflow (+ human checkpoint)

```
mock HTML ─► decompose into blocks/templates/parts (HUMAN-GUIDED judgment)
          ─► pnpm gen:block / gen:template      (scaffolds both halves + registries)
          ─► fill load() data-binding + .vue markup/styles  (agent)
          ─► author fixtures → apps/api/fixtures/<name>/     (agent)
          ─► pnpm verify:theme ──┐ structure + content; machine-readable failures
                   ▲             │ agent self-corrects
                   └─────────────┘ loop until GREEN
          ─► pnpm dev → preview in hybrid; screenshot vs mock  (agent)
          ─► ★ HUMAN QA CHECKPOINT ★  visual fidelity, data binding, runtime render,
             a11y/responsive, decomposition sanity, role-template selection wiring
          ─► commit → build images (structure gate) → deploy → seed content
```

**The human checkpoint is after structure-green AND the hybrid preview renders.**
The gate proves *structural* correctness (keys match, types align, loaders don't
throw, bound slugs exist in fixtures); the **preview step** is where actual
`.vue` rendering is exercised; the **human** judges fidelity, runtime render,
a11y/responsive, and wires any role-template selection `gen` left as a TODO. The
autonomy claim explicitly rests on the preview step, not on `verify` alone.

---

## 8. Acceptance criteria / definition of done

A fresh assistant, given the exported repo + a mock HTML + `AGENTS.md`, can:
1. Produce blocks/templates/parts + fixtures where **`pnpm verify:theme` exits 0**
   (structure: zod metas, registry-coherence both ways, `@cms/blocks` build,
   typecheck, render-smoke; content: fixture zod + block↔fixture binding) —
   proving **structure**, not pixels.
2. **Render in hybrid** (`pnpm dev`) — the new template shows the new blocks with
   bound sample data; no blank/`unknown_block` placeholders. (Genuinely separate
   from #1 — render-smoke does not mount `.vue`.)
3. **No change outside the theme surface** — `check-theme-scope.mjs` passes; the
   blocks import-boundary lint passes.
4. **`@cms/blocks` builds**; admin sees the new blocks/templates.
5. **Deploy pipeline green** — `docker build` of both images succeeds (incl.
   Defect A/B fixes + builder-stage `verify:theme:structure`); the one-shot
   `seed:fixtures` populates content on a real image.
6. **Exactly one human QA pass** corrects fidelity/binding; no developer
   hand-wiring of registries was required.

---

## 9. Risks & what stays human-judgment

| Area | Why it stays human |
| --- | --- |
| **Decomposition** | Right block boundaries from a mock is design judgment; `gen` scaffolds, it doesn't decide. |
| **Visual fidelity** | Pixel/spacing/typography parity vs the mock — gate is structural (screenshot-diff deferred). |
| **Runtime render** | Render-smoke calls `load()`, never mounts `.vue`; a template error that throws at render passes the gate → caught only by preview/human. |
| **Data binding** | Which CPT/field/taxonomy feeds a block is semantic; the block↔fixture check catches *missing* slugs, not *wrong-but-present* ones. |
| **a11y / responsive** | Not asserted by the gate; human reviews. |
| **Role-template selection** | Conditions live only in `resolve-template.ts`; `gen` leaves a TODO. |
| **Cross-client reach** | Mitigated by per-client generated pointers, but non-AGENTS.md assistants still depend on the publisher pointing their tool at `AGENTS.md`. |
| **Fork/upgrade drift** | The export is the publisher's **owned fork**; vendor core updates won't auto-merge. A "publisher-blocks plugin dir" is out of scope unless vendor-pushed updates become a goal. |
| **`gen` editing the hand-maintained Vue map** | Anchor sentinels + coherence + typecheck backstop it; a malformed manual edit between anchors is caught by `verify`. |

---

## 10. Effort estimate & sequencing

| Phase | Scope | Est. (eng-days) | Depends on |
| --- | --- | --- | --- |
| 2a | `@cms/theme-kit` + anchors + `gen:block` (4 kinds) + `gen:template` (page/part/role-scaffold + fixtures) + `AGENTS.md` | **4–6** | — |
| 2b | `verify:theme` split (structure in theme-kit + content in api script; 7 checks incl. block↔fixture; `--json`) | **3–4** | 2a |
| 2c | import-boundary lint + diff-scope guard + web-builder gate **+ Defect B Dockerfile deps fix + real docker build** | **3–4** | 2b |
| 2d | export generates `CLAUDE.md` + Cursor/Windsurf pointers + README; confirm ship/strip set | **1–2** | 2a |
| 2e | **Defect A api-image fixtures fix** + document/verify one-shot seed against a real image; deploy docs | **1–2** | — (parallel) |
| 2f | screenshot-diff | **0 (deferred)** | — |
| **Total** | | **~12–18 eng-days (≈3–4 wks, 1 eng)** | long pole = `AGENTS.md` + few-shot quality; +Docker fixes carry build risk |

The ~45 existing blocks + templates/parts are the **few-shot pattern source** for
both `gen` and `AGENTS.md` — example quality drives autonomy more than code volume.
`gen`/`verify` are mechanical; the real long pole is **`AGENTS.md` + the few-shot
examples**, which determine how autonomous the loop *feels*. Budget real time there,
and define "done" as a **live dry run** — point a fresh assistant at a real mock and
watch where it stumbles — **not** as "`verify:theme` went green."

---

## Decisions — locked defaults & still-open

**Locked (recommended defaults adopted):**
1. Fixtures-data path → `apps/api/fixtures/<name>/*.json` (confirmed).
2. First-boot seed → one-shot `seed:fixtures` + Defect A fix (COPY fixtures into the
   api runner). Not `seed:examples` (can't carry authored content).
3. `@cms/theme-kit` runner → **`tsx`** (matches `apps/api/scripts`; no extra build step).
4. Registry insertion → **anchor-comment + string insertion** (lightweight, idempotent;
   no `ts-morph` dependency).
5. Role-template selection → **human-wired** — `gen` leaves a `// TODO(human)` marker
   in `resolve-template.ts`; never auto-wires selection conditions.

**Still open (non-blocking):**
6. **Vendor pre-push hook.** Ship an optional husky-style pre-push (`verify:theme` +
   scope guard), or leave the gate to the Docker build + CI only?
7. **Defect B scope.** Fix only `blocks`+`theme-kit` in the deps stages, or audit all
   Dockerfile COPY lists for other workspace omissions? **The Step-0 docker build
   (§1) resolves this** before 2c/2e start.

---

## Verification — how to test the kit end-to-end

1. **Scaffold/idempotency:** `pnpm gen:block --key author-card --kind standalone …`
   → both halves + both registry entries appear between anchors; re-run → no dupes.
   Generated fixtures land under `apps/api/fixtures/<name>/`.
2. **Gate (red→green):** rename one Vue registry entry → `pnpm verify:theme` exits
   1 with a `registry-coherence` message naming the key; fix → exits 0. Reference a
   `content_type_slug` not in fixtures → `block↔fixture` check fails.
3. **Fence:** `import '@cms/db'` in a block → `pnpm lint` fails; edit outside the
   surface → `node scripts/check-theme-scope.mjs` fails.
4. **Render (hybrid):** stop app containers, `pnpm dev`, apply the new template to a
   page, load admin :5173 + web :3001 → new blocks render with sample data (standing
   super_admin creds; exclude infrastructure.spec).
5. **Build gate + Defect B:** `docker build -f apps/web/Dockerfile .` and
   `-f apps/api/Dockerfile .` both succeed with `packages/blocks` + `packages/theme-kit`
   in the deps stages; break the theme → web build fails at `verify:theme:structure`.
6. **Seed + Defect A:** against a fresh stack, `docker compose run --rm api … seed:fixtures`
   loads content for `PUBLIC_TENANT_SLUG` (proves the runner contains
   `apps/api/fixtures/`); re-run → idempotent.
7. **Export integrity:** `pnpm export:starter` → unzip → assert `AGENTS.md`,
   generated `CLAUDE.md` + Cursor/Windsurf pointers, `packages/theme-kit/`,
   `apps/api/fixtures/`, and the `gen:*`/`verify:*` scripts are present, and
   `docs/`/`.claude/`/`.github/` are absent.
