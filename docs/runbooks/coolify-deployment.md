# Coolify deployment runbook

This is the end-to-end procedure for deploying the CMS to a Coolify host using
the repo's [docker-compose.yml](../../docker-compose.yml). The compose file
covers the full stack: Postgres, PgBouncer, Dragonfly, Meilisearch, MinIO, API,
worker, admin UI, and the Nuxt public site.

> **Two compose files, by design.** `docker-compose.yml` publishes **no host
> ports** — Coolify routes to the app services through its own proxy (see
> Domains below), and the host stays free of bindings so this stack never
> collides with Coolify's own Postgres/Redis (`port is already allocated`).
> A second file, [docker-compose.override.yml](../../docker-compose.override.yml),
> adds host port mappings for **local development only**; Coolify ignores it
> because it reads `docker-compose.yml` alone. Do not merge the override into
> the base or reference it in Coolify.

---

## 1. Pre-flight

Confirm these on the Coolify host before deploying:

- Coolify v4.x, Docker engine present and healthy.
- A reachable domain (or three subdomains — see "Domains" below).
- Outbound HTTPS to GitHub for clone + Docker Hub for base images.
- At least **2 vCPU / 4 GB RAM** free. Sharp image transforms and Meilisearch
  indexing both burst CPU and memory.

---

## 2. Create the Coolify application

1. In Coolify, **New Resource → Docker Compose**.
2. Point it at this repo (GitHub source, branch `main`).
3. Compose file path: leave as `docker-compose.yml` (root).
4. Build pack: **Docker Compose** (NOT Nixpacks).

---

## 3. Domains

The compose file ships three browser-facing services and publishes no host
ports, so Coolify's proxy is the *only* way in — assigning a domain is what
makes a service reachable. Pick one of:

**Option A — separate subdomains (recommended).** Map in Coolify:

| Service | Container port | Domain field value (note the `:port`)        |
|---------|----------------|----------------------------------------------|
| admin   | 80             | `https://admin.cms.example.com`              |
| api     | 3000           | `https://api.cms.example.com:3000`           |
| web     | 3001           | `https://cms.example.com:3001`               |
| minio   | 9000           | `https://minio.cms.example.com:9000`         |

> **Routing port is handled automatically.** The compose declares the Coolify
> magic variables `SERVICE_FQDN_API_3000`, `SERVICE_FQDN_WEB_3001`, and
> `SERVICE_FQDN_MINIO_9000`. The `_<port>` suffix makes Coolify emit the Traefik
> `loadbalancer.server.port` label, so each service's auto-generated domain routes
> to the right container port out of the box — no manual `:port`, no HTTP 502.
> (Historically a bare `SERVICE_FQDN_*` defaulted Traefik to port 80, which 502'd
> `web`/`api`/`minio`; `admin` listens on 80 so it was unaffected.) The table
> above is only for replacing the auto-generated domains with your own hostnames;
> appending `:port` to a **custom** domain is belt-and-braces — it forces the
> backend port even if the magic-var label is ever lost. Multiple domains are
> comma-separated, each with its own suffix.

You set these by editing the service in Coolify's UI (each service in a
compose deployment exposes a "Domains" field). Coolify generates Traefik
labels automatically and provisions Let's Encrypt certs.

**MinIO is the one backing service that needs a public domain** — the browser
uploads/downloads media directly to it via presigned URLs. It already carries
`SERVICE_FQDN_MINIO_9000`, so its auto-generated domain routes to the S3 API on
**port 9000**, and `S3_PUBLIC_ENDPOINT` auto-derives from it (see §4 — no manual
entry needed). Do **not** expose port 9001 (the MinIO console). Because the
S3 API is now internet-facing, **rotate the default `minioadmin/minioadmin`
credentials** (set `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` on the minio service
and the matching `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` on api + worker). The
bucket stays private; objects are reachable only through time-limited signed
URLs, and the access *secret* is never placed in a URL.

**Do NOT assign a domain to the other backing services** (postgres, pgbouncer,
dragonfly, meilisearch, minio-setup) — they must stay internal. If Coolify
auto-generated FQDNs for them, clear those domain fields.

**Option B — single domain, path-routed.** Put admin at `/admin`, API at
`/api`, web at `/`. Requires custom Coolify routing labels — leave this for
later unless you specifically want it.

No API-base or CORS env is needed: both admin and web reach the API
**same-origin** through their built-in proxies (see §4).

---

## 4. Environment variables (set in Coolify's UI)

The compose file resolves these from the deployment environment. **Required:**

| Var                              | Why                                                                   |
|----------------------------------|-----------------------------------------------------------------------|
| `PREVIEW_TOKEN_SECRET`           | HMAC for preview tokens. Must be ≥32 chars in production.             |
| `WEBHOOK_SECRET_ENCRYPTION_KEY`  | AES-256 KEK for stored webhook secrets. Must be ≥32 chars in prod.    |
| `MEILI_MASTER_KEY`               | Meilisearch refuses to start in prod without one. ≥16 chars.          |
| `PUBLIC_TENANT_SLUG`             | Tenant served by `/api/public/*`. Match your seeded tenant.           |
| `S3_PUBLIC_ENDPOINT`             | **Auto-derived** from the minio service's public URL (`SERVICE_URL_MINIO`) — leave unset; set explicitly only to override (e.g. a CDN). It signs browser-facing media URLs, so a missing value would point presigned URLs at the internal `http://minio:9000`. |

> **Public site URL is NOT an env var.** After first deploy, set it in the
> admin under **Settings → Site Settings → Site URL** (the public Coolify
> domain of the `web` service, e.g. `https://news.example.com`). It drives the
> admin's "Preview" buttons + outbound email links, and takes effect on save
> (no redeploy). It lives in the database, per environment — the seed fixture
> ships `http://localhost:3001` for local dev, and if that value reaches
> production the page-editor's live-preview iframe loads `localhost` (the admin
> user's own machine) and shows **"localhost refused to connect."** Reseeding
> no longer overwrites it once set, but set it here first on every environment.

> **⚠️ Instant publishing needs `PURGE_SECRET` — set it, or content lags 5 minutes.**
> The public site caches its home / stories / archive pages for 300s. When an editor
> publishes or edits, the API tells the web app to drop those cached pages **only if**
> `PURGE_SECRET` is set to the **same non-empty value on BOTH the `api` and `web`
> services**. If it's empty (the default) or the two differ, every published change
> takes **up to 5 minutes** to appear — the #1 "why isn't my post showing?" cause.
> This is **required for any publishing site**, not optional. Generate it in §4,
> set it on both services, and verify with the publish smoke test in §7. The admin's
> **Tools → Purge Cache** page reports the exact problem if it's still misconfigured.

**Theme-editor / Block-Gallery env (set on the `web` service):**

| Var                  | Why                                                                        |
|----------------------|----------------------------------------------------------------------------|
| `NUXT_ADMIN_ORIGIN`  | **Auto-derived** from the admin service's public URL (`SERVICE_URL_ADMIN`) — leave unset; set explicitly only to override. Lets the admin **iframe** the public site for the dynamic page editor's live preview, the structure editor's live preview, and the Block Gallery's per-block previews. Without a value those iframes render blank (the web app falls back to `X-Frame-Options: SAMEORIGIN`); the web container logs a one-time warning at boot when it's missing. |
| `PURGE_SECRET`       | **Required for instant publishing** (see the ⚠️ callout above). Set the **same** value on the `api` **and** `web` services so published edits + theme changes appear immediately instead of after the 300s TTL. Empty (the default) or mismatched = every change lags up to 5 min on home/stories/archive. |

> **If the purge silently does nothing on live** (edits / Purge-Cache still take
> the full 300s to appear), the `api` container likely can't reach its own public
> domain to POST the purge — the purge is the one call that uses the *public* Site
> URL, while every other api↔web hop uses the internal name. Set **`WEB_INTERNAL_URL`**
> on the **`api`** service to the web service's internal address (e.g.
> `http://web:3001`); the purge then goes over the internal Docker network instead
> of the public Site URL. Leave it empty to keep using the public Site URL. The
> Tools → Purge Cache page now reports the exact reason (secret unset/mismatch,
> Site URL missing, or unreachable) so you can tell which of these it is.

**The admin and public sites need no API-URL or CORS env.** Both reach the API
**same-origin** through a built-in proxy (admin via nginx, the Nuxt site via a
Nitro `/api/public/**` route rule baked to `http://api:3000`). So
`NUXT_PUBLIC_API_BASE` is obsolete and `CORS_ALLOWED_ORIGINS` is **optional** —
only set the latter if you have a *separate* browser app calling `/api/v1`
cross-origin. If Coolify pre-populated `NUXT_PUBLIC_API_BASE`, you can delete it.

**Generate the secrets** — a fresh 64-hex value for `PREVIEW_TOKEN_SECRET`,
`WEBHOOK_SECRET_ENCRYPTION_KEY`, and `PURGE_SECRET`:

```bash
# Linux/macOS — run once per secret (each prints a fresh 64-hex / 256-bit value)
openssl rand -hex 32   # -> PREVIEW_TOKEN_SECRET
openssl rand -hex 32   # -> WEBHOOK_SECRET_ENCRYPTION_KEY
openssl rand -hex 32   # -> PURGE_SECRET  (paste the SAME value on BOTH api and web)
```

```powershell
# PowerShell equivalent — run once per secret
[Convert]::ToHexString((1..32 | %{ Get-Random -Maximum 256 }))
```

**Optional but recommended:**

| Var                              | Default            | Notes                                            |
|----------------------------------|--------------------|--------------------------------------------------|
| `LOG_LEVEL`                      | `info`             | `debug` while bringing up; flip to `info` after. |
| `BACKUP_S3_PREFIX`               | `backups/postgres` | Object-prefix inside S3_BUCKET for pg_dump.      |
| `BACKUP_RETENTION_DAYS`          | `30`               | Older dumps are pruned by the backup script.     |
| `EMAIL_PROVIDER`                 | `stub`             | Set to `smtp`/`resend`/`sendinblue`/`http`.      |
| Provider-specific email vars     | empty              | See `.env.example` for each provider's vars.     |
| `S3_PUBLIC_URL`                  | empty              | Set to your CDN base if media isn't served from MinIO directly. |

The bundled Dragonfly + Postgres + PgBouncer + Meilisearch run on the compose
network with default creds (`postgres`/`postgres`). Because `docker-compose.yml`
publishes no host ports and you assign them no domain, they're reachable only
inside the compose network — so their defaults are acceptable to start; still
rotate them before real production, and never give them a host port or domain.

**MinIO is the exception** — it gets a public `:9000` domain (§3) so browsers
can upload/download media, which means its S3 API is internet-facing. **Rotate
`minioadmin/minioadmin`** to strong credentials there before going live (set
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` + the matching `S3_ACCESS_KEY_ID`/
`S3_SECRET_ACCESS_KEY`). The bucket stays private (signed-URL access only).

---

## 5. First deploy

1. Click **Deploy** in Coolify. The first build is slow (~5–10 min) — pnpm
   install + Turbo build runs once per app. Subsequent builds use the
   Docker BuildKit cache and are 1–3 min.
2. Watch the logs. Healthchecks gate startup order:
   - `postgres` → healthy → `pgbouncer` starts
   - `dragonfly`, `meilisearch` → healthy in parallel
   - `minio-setup` → bucket created → exits clean
   - `api`, `worker` start once all upstream deps are healthy
   - `admin`, `web` wait for `api` to be healthy
3. Confirm all containers reach **Running** (not Restarting).

---

## 6. Post-deploy: migrate the database, seed the admin

The API container ships **without** running migrations on boot — Coolify
restarts shouldn't keep re-running DDL. Do it once, manually. **Symptom if you
skip this:** the login page loads but submitting returns
`relation "admin_users" does not exist` (Postgres 42P01).

Open a **terminal on the `api` container** in Coolify (Resource → api →
Terminal). You start in `/repo`. Run, in order:

```bash
# 1. Create the schema. Uses DIRECT_DATABASE_URL from the container env
#    (bypasses PgBouncer — required for DDL). Idempotent.
cd /repo/packages/db && node_modules/.bin/drizzle-kit migrate

# 2. Seed the super-admin + a demo content type.
cd /repo/apps/api && node_modules/.bin/tsx scripts/seed-test-admin.ts

# 3. (Optional) richer Mill-Times demo dataset — stories, menus, settings.
cd /repo/apps/api && node_modules/.bin/tsx scripts/seed-examples.ts
```

> These call the binaries directly rather than the `pnpm`/`db:migrate` npm
> scripts: those scripts wrap the command in `dotenv -e ../../.env`, and there
> is no `.env` file inside the container — the env comes from Coolify's
> environment. The commands above read the container env directly. `drizzle-kit`
> and `tsx` are present because the production image keeps devDependencies.

After step 2 you can sign in to the admin UI with:

```
email:    admin@test.com
password: test1234
```

**Change this password immediately** in the admin UI's user-management panel.

---

## 7. Smoke test

From your laptop, hit the deployed URLs:

```bash
# API liveness — must return JSON { ok: true, ...} and 200
curl -fsS https://api.cms.example.com/health

# Worker readiness — same shape
curl -fsS https://api.cms.example.com/ready

# Public read endpoint — must return JSON, may be empty data if no published content
curl -fsS https://api.cms.example.com/api/public/site-settings

# Admin UI — must serve HTML (Vue SPA shell)
curl -fsS https://admin.cms.example.com/ -o /dev/null -w "%{http_code}\n"

# Public site — must SSR a page (look for <title>Mill-Times Mumbai</title>)
curl -fsS https://cms.example.com/ | grep -i '<title>'
```

In the browser:

1. Open the admin UI → login with `admin@test.com / test1234`.
2. Confirm the dashboard loads and lists content types.
3. Open the public site → confirm the homepage renders (logged-out state).
4. Open `https://api.cms.example.com/docs` — Swagger UI should be **404 in
   production**. If it's accessible, `NODE_ENV` isn't set to `production`.
5. **Publish test — verifies `PURGE_SECRET`.** In the admin, edit a story's
   title and save (or click **Tools → Purge Cache → Clear website page cache**),
   then reload the public homepage within a few seconds — the change should
   already be there. If it only appears after ~5 minutes, `PURGE_SECRET` is empty
   or mismatched on the `api`/`web` services (§4); the Purge Cache page's toast
   names the exact reason.

> **Some images are picked per-environment, not seeded.** Blocks that pull from
> the media library — the home page's **Brand Logo Strip** and **Studio
> Gallery** — ship empty in the fixtures (media rows are never seeded). Their
> pictures are chosen in the admin **on each environment**: edit the Home page,
> open each block, and pick the logos / photos from the media library. Until
> then those blocks show empty placeholder boxes. Because the Home page is
> `system_managed`, **re-running the fixture seed clears these picks** — re-pick
> after any reseed, or don't reseed the home page once it's set. (If a picked
> image then shows a broken-image icon rather than the photo, the storage public
> endpoint is the culprit — see `S3_PUBLIC_ENDPOINT` in §4.)

---

## 8. Backups (don't skip)

The `backup` service is profile-gated so it doesn't run on every `docker
compose up`. Schedule it via Coolify's cron-job UI:

- **Command:** `docker compose run --rm backup`
- **Frequency:** daily, at off-peak UTC.
- **Restore drill:** see [postgres-restore.md](postgres-restore.md). Run it at
  least once before treating the backup as load-bearing.

---

## 9. Known caveats for this deployment

- **Base image is Node 22 (current LTS).** All four Dockerfiles use
  `node:22-bookworm-slim`. `pnpm@11.x` (the workspace's pinned package
  manager) imports `node:sqlite`, a Node 22+ built-in; Node 20 fails the
  install with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. If you bump pnpm
  or the base image, keep them on compatible majors.
- **Both frontends call the API same-origin — no CORS needed.** The admin
  proxies `/api/*` through its nginx; the Nuxt site proxies `/api/public/**`
  through a Nitro route rule (baked to `http://api:3000`). So browser requests
  never go cross-origin and `CORS_ALLOWED_ORIGINS` is not required for them. The
  API still defaults to `origin: false` in production, which only matters if you
  add a *separate* cross-origin browser client against `/api/v1` — then list its
  origin in `CORS_ALLOWED_ORIGINS`.
- **Public API traffic shares the web container's source IP.** Because the Nuxt
  site proxies public reads, the API sees them coming from the `web` container.
  The API has `trustProxy: true` and rate-limits on `req.ip` (X-Forwarded-For
  aware), but if the Nitro proxy doesn't forward `X-Forwarded-For` the public
  rate-limit bucket (`RATE_LIMIT_MAX`, default 100/min) is shared across all
  visitors. SWR page caching keeps API hits low, so this rarely bites; bump
  `RATE_LIMIT_MAX` if you see spurious 429s under load.
- **Backing services have no host ports.** Postgres (`trust` auth), PgBouncer,
  Dragonfly, and Meilisearch are reachable only on the compose network —
  `docker-compose.yml` publishes no host ports and you should assign them **no
  Coolify domain**. If Coolify auto-generated `SERVICE_FQDN_*` for them, remove
  those domains in the UI. Rotate their default creds before production.
- **MinIO is intentionally public (`:9000` domain).** Required for browser media
  upload/download via presigned URLs (`S3_PUBLIC_ENDPOINT`). Its S3 API is
  internet-facing, so rotate `minioadmin/minioadmin` and never expose the
  `:9001` console. The bucket is private — access is via signed URLs only.
- **`db:migrate` is manual.** See section 6. There's no migration-on-boot
  step — that's deliberate, but means you must remember after a schema change.

---

## 10. When something breaks

```bash
# Tail a service's logs
docker compose logs -f api
docker compose logs -f worker

# Restart one service in place (faster than full redeploy in Coolify)
docker compose restart api

# Rebuild a single service from scratch (clears the Docker layer cache for it)
docker compose build --no-cache api
docker compose up -d api

# Inspect what env the api actually got
docker compose exec api env | sort
```

If `api` keeps crashing at boot with a `@cms/config` validation error, the
secret is too short or missing — set it in Coolify's env panel and redeploy.
The error message names the exact var.
