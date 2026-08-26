# Phase 3 — Versioning, Releases & Publisher Updates — Plan

> **Status:** Approved plan (2026-08-25). This phase makes the CMS shippable to
> multiple publishers and updatable in place. It adds no content features.
>
> **Note:** `docs/` is *not* `export-ignore`d, so this file ships in the starter
> zip. That is fine — it doubles as the upgrade contract publishers can read.
> `CLAUDE.md` and `.github/` **are** export-ignored, so the release automation
> and the authoring rules stay in the source repo only.

---

## Context — why this is being built

Today the CMS is handed to a publisher as a zip produced by `pnpm export:starter`.
That zip is built with `git archive HEAD`, so it carries **no `.git`**, and the
first-run guide tells the publisher to run a fresh `git init`. The result: a
publisher's install has no link back to the source repo, and **there is no
upgrade path at all**. A bug fixed here can never reach them.

Phase 3 closes that. It gives the product:

1. A **version number** that a running install knows about itself.
2. A **release channel** on GitHub (tags + release notes + a machine-readable manifest).
3. **Update detection** — the install notices a new version and tells the operator.
4. **Update install** — a safe, one-step way to actually apply it.
5. A **repo split** so a publisher's theme code and the core code stop living in
   the same tree, which is what makes updates conflict-free.

---

## Settled decisions

| Question | Decision |
|---|---|
| Distribution | Git-based, hosted on GitHub |
| Who owns the theme | The publisher. The CMS ships two themes (`default`, `basic`); a publisher's CUSTOM theme is their own and is never distributed or updated. Superseded the earlier "separate repos" idea — see *Theme shipping model*. |
| Who triggers an update | Operator-initiated. The install detects and offers; the update is applied deliberately, never silently. |
| Registry for images | GitHub Container Registry (`ghcr.io`), private, read token per publisher |
| Tenancy model | **One tenant per install.** Each publisher runs their own Postgres. |
| v2 | **Not planned.** All schema evolution stays additive inside v1. See below. |

---

## The versioning rule

Semver, with one project-specific reading of "major":

| Change | Bump | Example |
|---|---|---|
| Bug fix, no schema change | patch — `1.2.3` to `1.2.4` | fix a broken button |
| Feature, no schema change | minor — `1.2.4` to `1.3.0` | new block |
| Feature with an **additive** schema change | minor — `1.3.0` to `1.4.0` | add a `comments` table, add a nullable column |
| **Breaking** schema change | major — `1.x` to `2.0` | drop / rename / retype a column |

The important correction to the original idea: **a schema change is not
automatically a major.** Only a *breaking* schema change is. Roughly 90% of real
migrations are additive, and those ship as minors — which means a bug fix that
needs a new nullable column can still reach every publisher without a major.

### Safe forever vs. forces a major

| Safe (stays in v1) | Forces a major |
|---|---|
| add a table | drop a column |
| add a nullable column | rename a column |
| add a column with a default | change a column type |
| add an index | remove or reorder an enum value |
| add an enum **value** | add `NOT NULL` with no default and no backfill |
| add a constraint *after* backfilling | change a primary key |
| add RLS policies | |
| anything inside a `jsonb` column | |

### Expand, migrate, contract

When a change looks breaking, split it across releases so it isn't:

- **v1.5** — ADD the new column. Code writes to **both** old and new, reads new
  with a fallback to old. Old installs keep working; the old column still exists.
- **v1.6** — backfill the new column for old rows. Code now reads only the new one.
- **v1.7+** — the old column is *deprecated but kept*. It is only ever dropped in
  a real major, and only if a major is ever justified.

Evidence this matters, from this repo's own history: migration `0014` ran
`ALTER TABLE "pages" DROP COLUMN "layout_template"` and migration `0015` added it
straight back. **Do not drop columns. Stop using them.**

---

## Why there is no v2 — the schema verdict

The known concern was the tenancy design. Reviewed across all 29 tables:

- **21 tables** carry a **nullable** `tenant_id`; **8** carry it `NOT NULL`
  (`media`, `media_folders`, `pages`, `page_templates`, `theme_overrides`,
  `webhooks`, `api_keys`, `public_users`).
- Parent/child pairs disagree: `pages` is NOT NULL but `page_revisions` is
  nullable; `theme_overrides` is NOT NULL but `theme_override_revisions` is not.
- There is **no RLS**. Isolation depends on ~70 API files calling `tenantFilter()`
  in `apps/api/src/lib/tenant-scope.ts`.

**This is dead weight, not a live bug.** As `apps/api/scripts/fold-to-single-tenant.ts`
states, the schema was shaped for a SaaS variant that was never shipped; the
product runs **one tenant per install**, each with its own Postgres. There is no
second tenant to leak to.

It can also be cleaned up **inside v1**, additively:

1. `UPDATE ... SET tenant_id = <the one tenant> WHERE tenant_id IS NULL` — data only.
2. Once no code path writes NULL, `ALTER COLUMN tenant_id SET NOT NULL`.
3. Add RLS policies — a policy is not a schema change; enable permissive first,
   then tighten.

The only thing that would genuinely require a major is a decision to become a
real multi-tenant SaaS, because `tenantFilter()` deliberately returns `undefined`
for `super_admin` (no filter — sees every tenant). That is a product decision,
not schema debt.

### What the schema does well (why additive-forever is realistic)

- **jsonb in the right places** — `content.custom_fields`, `pages.blocks`,
  `pages.body`, `seo`, `settings`. New content fields need **zero migrations**.
- Composite indexes matching real query shapes, a partial index on
  `translation_group_id`, an expression index on `COALESCE(publish_at, published_at) DESC`.
- `nullsNotDistinct()` on the slug uniques — the NULL-tenant edge case is handled.
- Append-only history tables (revisions, status transitions, view events).
- Deliberate FK delete rules (`restrict` on tenant, `cascade` on revisions,
  `set null` on author) — not copy-paste.
- Only 4 `DROP COLUMN`s across 26 migrations, all early.

### What to watch

1. **Postgres enums (10 of them).** Adding a value is easy; removing or reordering
   is a breaking change. Before adding a new enum, ask whether a value might ever
   need removing — if yes, use `text` plus a `CHECK` instead. `content_status` and
   `admin_role` are the likeliest to change.
2. **`uuidv7()` requires Postgres 18.** 22 tables depend on it. Publishers cannot
   run on PG 16/17. Document as a hard requirement.
3. **Seven `*_settings` tables**, one row per tenant each. Adding a setting is
   `ADD COLUMN` (fine). Do not add an eighth settings *table*.
4. **No soft delete on content.** Deletes are permanent and cascade to revisions.
   Adding `deleted_at` is additive — do it sooner rather than later.

---

## The sequence

Ordered so the live PING site is never at risk, and so each step ships as a real
release through the pipe built in v1.1.0. **PING is publisher #1** — if PING runs
on the new architecture and looks identical, the model is proven.

| Version | What | Risk |
|---|---|---|
| **v1.0.0** | Tag today's code. Cut `release/v1`. No code changes. | none — this is the rollback point |
| **v1.1.0** | Release **detection**: version baked into the build, `releases.json` manifest, update-check cron, admin banner | low, additive |
| **v1.2.0** | Replace the 300-line hand-written `packages/blocks/src/registry.ts` with a folder scan | low — removes the biggest merge-conflict source |
| **v1.3.0** | Physically split core blocks from PING blocks (also templates and parts). Still one repo. | medium — the hard call is already made (see below) |
| **v1.4.0** | Publish core base images to `ghcr.io` | medium |
| ~~v1.5.0~~ | ~~Move PING's theme to its own repo~~ — **dropped**, see *Theme shipping model* | n/a |
| **v1.4.1** | Theme shipping model: exports carry only the CMS themes | low |
| **v1.6.0** | Update **install/apply** workflow | built last, once "apply" has a known shape |

**Why detection before apply:** detection (version, manifest, cron, banner) is
untouched by the refactor. Apply is not — before v1.5 it means "git merge", after
it means "change an image tag". Building apply first means building it twice.

**Why do the refactor now:** PING is currently the only install. Doing the split
before publisher #2 exists means no publisher ever has to live through it.

---

## v1.2.0 / v1.3.0 — the registry split

Current state:

- `packages/blocks/src/registry.ts` — 300 lines of hand-written imports. Every new
  block edits this one shared file. **This is the file that will conflict** when
  core updates meet publisher edits.
- **77 block files**, of which `CORE_BLOCK_KEYS` in `packages/blocks/src/themes.ts`
  names **23 as core** — the other 54 are PING-specific. Also 20 templates
  (`CORE_TEMPLATE_KEYS` names 2) and 3 parts (`CORE_PART_KEYS` names 2).
- `themes.ts` already anticipates this phase in its own comment: *"A later phase
  physically splits the Decode blocks into their own layer."*

**The hardest judgment call — which block is core — is already made.** The split
is guided by those three existing sets.

Target state:

```
core repo:      packages/blocks/src/blocks/     (23 core blocks, auto-scanned)
                packages/blocks/src/templates/  (2 core templates)
                packages/blocks/src/parts/      (2 core parts)

publisher repo: theme/blocks/                   (their blocks, auto-scanned)
                theme/templates/  theme/parts/
                theme/app/                      (Vue components, CSS, composables)
                fixtures/
```

---

## Theme shipping model (settled v1.4.1 — supersedes the v1.5.0 repo split)

The CMS ships **two** themes, and both are CMS parts that receive updates:

- **`default`** — the generic core layer: pages, the data layer, the block
  resolver, and the 39 core renderers.
- **`basic`** — the neutral starter, layered on `default`.

Anything else is a **custom theme**: a directory a publisher builds by hand
under `apps/web/themes/<name>/` (plus `packages/blocks/src/themes/<name>/` for
its server blocks). PING's is one. A custom theme:

- **stays in the install that made it** — no separate repo, no cutover;
- is **excluded from `pnpm export:starter`** via `export-ignore`, so a new
  publisher never receives another publisher's design, brand marks or content;
- **never receives updates** — it is the publisher's own work, and core is
  forbidden from touching it (`scripts/check-theme-scope.mjs` denies edits to
  `default` and `basic` in the other direction, so an authoring session cannot
  collide with a CMS update either).

`ACTIVE_THEME` names the theme; it defaults to `default` and falls back to
`default` if the named directory is absent. It must never default to a custom
name — an export contains none, so a fresh install would point at a layer that
does not exist.

**Why the repo split was dropped.** Separating core from the theme is what makes
conflict-free updates work, and v1.3.0/v1.4.0 already achieved that inside one
repo: separate directories, enforced by a guard, with `basic` verified rendering
standalone. A second repository added a live-site cutover and ongoing two-repo
coordination without changing that outcome. Excluding the custom theme from the
export gets the same result in a `.gitattributes` rule.

Revisit only if a custom theme needs its own release cadence, or if someone must
work on a theme without core access. Neither applies today.

---

## v1.4.0 — image split

A block is two halves: `meta` (plain data) and `load(ctx, ...)` (**server code the
API executes**). The second half is why blocks cannot be shipped as data files —
the API is a compiled Node image and cannot load a publisher's TypeScript at
runtime the way WordPress loads PHP.

Resolution — the publisher repo carries two thin Dockerfiles:

| Image | Needs publisher code? | How |
|---|---|---|
| **admin** | **No** | Already fetches block metas from `GET /admin/blocks` at runtime (`apps/api/src/routes/admin/blocks.ts`). The `@cms/blocks` mentions in `apps/admin/src` are comments only. Pure core image. |
| **worker** | No | Pure core image |
| **api** | Yes (`load()`) | `FROM ghcr.io/<org>/cms-api-base:1.4.0` plus COPY blocks plus build |
| **web** | Yes (Vue, CSS) | `FROM ghcr.io/<org>/cms-web-base:1.4.0` plus COPY theme plus build |

A publisher repo becomes: `docker-compose.yml` (image tags, no `build:` for admin
and worker), two 5-line Dockerfiles, `theme/`, `fixtures/`, `.env`. **Core code
never enters their tree, so there is never a merge.** Update = change the tag.

Side benefit: publisher deploys stop building all six services from source
(currently 5–10 minutes on first build).

### Theme compatibility

Once the theme is a separate repo it needs to declare what core it targets, e.g.
`requiresCore: "^1.4"` in the theme manifest. Core refuses to boot with a clear
message if the theme is too old. (WordPress does this with `Requires at least:`.)

---

## Release mechanics — GitHub

- **Tags** `v1.2.3` on `release/v1`. Tags are the source of truth.
- **GitHub Releases** carry the human-readable notes.
- **`releases.json`** — a machine-readable manifest published per release
  (GitHub Pages or a raw URL on a stable branch). One entry per version:

```jsonc
{
  "version": "1.4.0",
  "type": "code",                     // "code" | "schema" — schema runs migrations
  "released": "2026-09-14",
  "notes_url": "https://github.com/<org>/<repo>/releases/tag/v1.4.0",
  "min_upgrade_from": "1.2.0",        // refuse to jump from older; hop first
  "requires_backup": false,           // true for any schema release
  "new_env_vars": ["EXAMPLE_VAR"],    // config that must be set before booting
  "images": { "api": "ghcr.io/<org>/cms-api-base:1.4.0" }
}
```

- `.github/workflows/release.yml` builds and pushes the `ghcr.io` images on tag,
  and regenerates `releases.json`. (`.github/` is export-ignored, so publishers
  do not inherit this workflow.)

### Minimum upgrade path

`min_upgrade_from` is the GitLab model: an install on 1.2 that sees 1.6 is told
*"update to 1.4.x first, then 1.6."* One field, and it prevents the untested
long-jump upgrade.

### Support window

| Version | Gets |
|---|---|
| current major | everything — features, fixes, security |
| previous major | security plus critical fixes only, ~6–12 months |
| older | nothing — upgrade first |

Since there is no v2 planned, in practice this means: **support v1, keep it
healthy.** The real defence is making upgrades easy enough that nobody lags.

---

## v1.1.0 — update detection design

1. **Version in the build.** Root `package.json` `version` gets baked in at build,
   exposed by the API, and shown in the admin footer. Also recorded in the DB
   after a successful migration run, so "code version" and "schema version" are
   both visible.
2. **Where it is stored.** `system_settings` is per-tenant; the install version is
   per-install. Use a small dedicated table (or a NULL-tenant row) — do not
   overload a per-tenant settings table.
3. **The check job.** A BullMQ repeatable job in the worker, daily. The worker
   already registers repeatable jobs (`apps/worker/src/index.ts` — the
   scheduled-publish sweep and the Meili drift sweep). Fetches `releases.json`,
   compares, writes the result.
4. **The banner.** Super-admin only. Shows version, type, and notes link.
   A `schema` release gets a distinct banner: *"this update changes your database;
   a backup runs first"*, with explicit confirmation.
5. **Opt-out.** A setting to disable the update check entirely (some publishers
   will not want outbound calls).

---

## v1.6.0 — update install design

A container cannot rebuild itself, so "apply" hands off to something outside it.
On Coolify the clean path is **Coolify's deploy webhook**: the install stores the
webhook URL, and applying an update POSTs it. Coolify pulls the new tag, builds,
runs the one-shot `db-migrate`, restarts. **No Docker socket is exposed to the
application.**

Because the operator also wants to push updates from the source side, the same
webhook list doubles as a small update roster.

Required around it:

- **Pre-flight**: refuse if `min_upgrade_from` is not satisfied, if a required new
  env var is missing, or if the DB is unreachable.
- **Backup before any `schema` release** — `scripts/backup-postgres.sh` and the
  `backup` compose service already exist; wire them in.
- **Rollback**: redeploy the previous tag. Only reliable because migrations are
  additive — which is the whole point of the versioning rule. Tested; see below.
- **Migrations are already safe to re-run.** `db-migrate` runs on every boot and
  is a no-op when the journal is current.

### How this gets validated — a second install

Everything so far has been proven on ONE install, which is also the development
machine. That is enough for detection (which only reads a manifest) but not for
apply, where the whole point is that a DIFFERENT machine receives a change it
did not make.

So v1.6.0 is validated against a **test install**: a second deployment from the
starter export, with its own database, its own `.env`, and no access to this
working tree. It is the first thing in this phase that exercises the product the
way a publisher actually meets it.

What only a second install can show:

1. **The starter export really is self-sufficient.** It now excludes the custom
   theme — nothing has yet confirmed what remains actually boots on its own.
2. **The banner appears somewhere that is not here.** Detection has only ever
   been observed against a dev build reading a manifest it was pointed at.
3. **Apply works without the source repo.** The install has no git remote to
   this tree; it has an image tag and a webhook, and that has to be enough.
4. **A schema release is survivable.** Take a backup, apply a migration, confirm
   the data is intact — and then roll back and confirm it again. The rollback
   procedure below was proven by running old code against a newer database, but
   never on a machine that was not this one.
5. **The failure modes are legible.** Point it at an unreachable manifest, at a
   version below `min_upgrade_from`, and at a release naming an env var that is
   not set. Each should say plainly what is wrong. A confusing failure on
   someone else's server is expensive in a way it is not here.

Order matters: stand up the test install BEFORE building apply, so the target
exists while the mechanism is written rather than after. Detection can be
confirmed on it immediately — it should sit quietly at the current version, then
show the banner the moment a newer release is published.

---

## Rollback — tested procedure

The claim the whole no-v2 strategy rests on is that an **additive** migration
lets you roll back CODE without rolling back the DATABASE. That was reasoning,
not evidence, until it was exercised on 2026-08-26.

**What was tested.** `v1.0.0` application code run against a live database
already carrying migration `0026` (`update_status`) — a table that version has
never heard of. This is exactly what a publisher hits when an update goes wrong:
they redeploy the previous version, but their database has already moved on.

**Result: pass.** All 7 PING pages returned HTTP 200 with block counts
identical to the current release (8, 2, 3, 9, 5, 5, 8); all 3 parts returned
200; the API log contained no errors — no missing relation, no missing column.

**Why it works, so the limits are clear.** Drizzle selects named columns, so a
table or column the running code never references is invisible to it. That
holds for anything *added*. It does NOT hold for a dropped or renamed column, a
changed type, or a new `NOT NULL` — which is precisely the set
`scripts/check-migrations.mjs` now refuses.

**The procedure**

1. Note the version to return to (the previous tag; the admin footer shows what
   is running now).
2. Take a database backup anyway — `scripts/backup-postgres.sh`. Rollback should
   not need it; take one before touching production regardless.
3. Point the deployment at the previous tag and redeploy. Do **not** attempt to
   revert migrations: the journal is forward-only and the extra schema is inert.
4. Confirm the site serves and the admin loads. The banner will offer the newer
   version again — that is correct, not a leftover.

**Re-testing it** (hybrid/dev, never against the live container):

```bash
git worktree add --detach <tmp>/rollback-<version> <tag>
cp .env <tmp>/rollback-<version>/.env
cd <tmp>/rollback-<version> && pnpm install --prefer-offline
npx turbo run build --filter=@cms/api...
cd apps/api && ../../node_modules/.bin/tsc -p tsconfig.build.json
API_PORT=3011 node --env-file=../../.env dist/index.js
```

Then request the public pages on `:3011` and compare block counts against the
current release. Two snags worth knowing: `pnpm --filter @cms/api build` in a
fresh worktree triggers a deps check that runs the web app's `nuxt prepare`,
which fails on an unrelated rollup/CJS export mismatch — hence invoking `tsc`
directly. And `git worktree remove` can fail on Windows with "Filename too long"
on deep `node_modules` paths; `git worktree prune` still cleans the metadata.

---

## Hard rules for this phase

1. **Freeze features from v1.1.0 through v1.5.0.** Bug fixes for the live PING
   site go on `release/v1` and merge forward. New features wait.
2. **Fix on the oldest affected branch, then merge forward.** Never fix on the
   newest branch and try to remember to backport.
3. **A core release must never touch the publisher surface.**
   `scripts/check-theme-scope.mjs` already lists that surface to stop a
   publisher's agent editing core; add the mirror check so a core release diff
   cannot touch `packages/blocks/src/{blocks,templates,parts}`,
   `apps/web/themes/**`, or `apps/api/fixtures/**`.
4. **Never drop a column.** Deprecate and stop using it.
5. **Take a visual baseline before v1.2.0** — screenshots of all 7 PING pages at
   desktop and mobile. The refactor must change nothing visually; a screenshot
   diff after each step catches a missing block registration immediately.
6. **Seeding is additive and never prunes** — an update must never reseed a
   publisher's content.

---

## Acceptance criteria

- [x] `v1.0.0` tagged; `release/v1` cut; a documented rollback tested once
- [x] A running install displays its own version
- [x] `releases.json` published and fetchable; the daily check writes a result
- [x] Admin shows an update banner for a newer version
- [ ] ...with a distinct confirmation flow for a `schema` release (v1.6.0)
- [x] `registry.ts` no longer hand-lists blocks; adding a block requires editing
      no shared file
- [x] Core and PING blocks live in separate folders; the admin palette is
      unchanged for PING and correctly narrowed for `basic`
- [ ] `ghcr.io` images build and push on tag (workflow written; fired on the
      v1.4.0/v1.4.1 tag pushes — outcome not yet confirmed)
- [x] Custom themes excluded from the export — verified by building the archive
      (0 files for themes/ping, fixtures/ping; default and basic ship)
- [ ] A TEST INSTALL stood up from the starter export, on its own database,
      boots and serves with no access to this working tree
- [ ] That install shows the update banner when a newer release is published,
      and nothing when it is current
- [ ] An end-to-end update (code-only) applied to the test install via the webhook
- [ ] An end-to-end update (schema) applied there, with a backup taken and the
      rollback performed on that machine — not on the dev box
- [ ] The three failure modes read clearly on the test install: unreachable
      manifest, version below min_upgrade_from, missing required env var

---

## Risks

| Risk | Mitigation |
|---|---|
| Refactor breaks PING's live site | `release/v1` stays deployable throughout; screenshot baseline; each step is its own release |
| A block gets lost in the core/theme split | The `CORE_*_KEYS` sets are the checklist; `pnpm verify:theme` is the gate |
| `load()` server code can't move to the theme repo | Solved by the base-image plus thin-Dockerfile approach; do not attempt to make loaders declarative in this phase |
| Publisher's Coolify can't pull from ghcr.io | Private image plus per-publisher read token, tested during v1.4.0 |
| Update applied without a backup | Pre-flight refuses; `requires_backup` is enforced, not advisory |
| Feature work sneaks in mid-refactor | Rule 1; enforce with the release checklist |
