# CMS Starter — first-run guide

This zip is a fresh-start snapshot of the custom-hocalwire-CMS monorepo,
produced by `pnpm export:starter`. Empty database, no demo content, all
services dockerized.

## 1. Start the stack

```bash
docker compose up -d --build
```

First boot takes ~60 seconds (Docker pulls base images, builds the api,
admin, worker, and web containers, then the one-shot `db-migrate` service
applies all Drizzle migrations to the freshly-initialised Postgres).

Tail logs while you wait:

```bash
docker compose logs -f db-migrate api admin web
```

Once `docker compose ps` shows `db-migrate` as `Exit 0` and the rest as
`healthy`, you're good.

## 2. Create the first admin user

Open **http://localhost:8080** — the admin app detects the empty DB and
shows a setup wizard. Fill in email, password (≥12 chars), display name,
and site name. Submitting creates the tenant + super-admin in one
transaction and signs you in.

## 3. Write a post

In the admin dashboard, create a post under your chosen content type
(default: Article). Publish it.

## 4. View the public site

Open **http://localhost:3001** — the Nuxt 4 public site fetches from the
api via a same-origin Nitro proxy and renders your published content.

## 5. After the wizard — set the site URL

Visit **Site Settings** in the admin and set **Site URL** to
`http://localhost:3001` (or your production URL). Without this:

- The admin's "Preview" buttons can't link to the public site.
- Outbound emails (review notifications, etc.) won't include working links.

## Reaching the rest of the stack locally

| Service       | URL                              | Notes                            |
| ------------- | -------------------------------- | -------------------------------- |
| Admin         | http://localhost:8080            | Setup wizard / dashboard         |
| Public site   | http://localhost:3001            | Nuxt 4 SSR                       |
| API           | http://localhost:3000            | Health: `/health`, docs: `/docs` |
| Worker        | http://localhost:3100            | Readiness: `/ready`              |
| Postgres      | localhost:5432                   | postgres / postgres              |
| PgBouncer     | localhost:6432                   | postgres / postgres              |
| Dragonfly     | localhost:6379                   | Redis-compatible                 |
| Meilisearch   | http://localhost:7700            |                                  |
| MinIO         | http://localhost:9000            | minioadmin / minioadmin          |
| MinIO console | http://localhost:9001            |                                  |

### Container names in `docker ps`

Containers are auto-named from the unzipped directory `cms-starter` →
`cms-starter-postgres-1`, `cms-starter-minio-1`, `cms-starter-api-1`,
etc. This keeps the starter stack from colliding with other Docker Compose
projects on the same host (e.g. the source CMS repo running in hybrid dev).
Rename the directory before `docker compose up` to scope the names
differently, e.g. `mv cms-starter my-publisher` → containers become
`my-publisher-postgres-1` and friends.

## AI theme authoring

This starter ships an AI theme-authoring kit. Open the repo in any coding
assistant (Claude Code, Cursor, Windsurf, Agent SDK) and point it at **AGENTS.md**
— it can turn a mock HTML design into a working theme (blocks, templates/parts,
fixtures) with you doing final QA. Always author in hybrid/dev, never on the live
container. After deploying, seed your starter content into the live DB:

    docker compose run --rm api pnpm --filter @cms/api seed:fixtures -- <name> --tenant=<PUBLIC_TENANT_SLUG>

## Modifying the public Nuxt app

Source lives in `apps/web/`. To iterate quickly with hot reload, switch
to hybrid dev:

```bash
docker compose stop api admin web worker     # keep backing services running
pnpm install
pnpm dev                                      # runs all four apps from source
```

Admin → http://localhost:5173 (Vite dev), api → http://localhost:3000,
public → http://localhost:3001.

## Resetting to a blank state

```bash
docker compose down -v   # also wipes postgres-data, dragonfly-data, etc.
docker compose up -d
```

The setup wizard reappears because the DB is empty again.

## Deploying to Coolify

This is the same `docker-compose.yml` Coolify reads natively — the starter
is already production-shaped. Outline:

### 1. Push the unzipped starter to a git repo

Coolify deploys from git, not zip uploads. From inside this directory:

```bash
git init && git add . && git commit -m "initial"
git remote add origin <your-git-remote>
git push -u origin main
```

### 2. Create the Coolify resource

In Coolify: **New Resource → Docker Compose**, point it at the repo above,
branch `main`, compose file `docker-compose.yml` (root), build pack
**Docker Compose** (NOT Nixpacks).

### 3. Set env vars in Coolify's UI (not via this `.env`)

The `.env` shipped in this zip is for local `docker compose up` and is
ignored by Coolify. Set these in Coolify's UI under the resource's env
section:

| Variable                          | Notes                                                  |
| --------------------------------- | ------------------------------------------------------ |
| `PREVIEW_TOKEN_SECRET`            | Required, ≥32 chars. `openssl rand -hex 32`            |
| `WEBHOOK_SECRET_ENCRYPTION_KEY`   | Required, ≥32 chars. `openssl rand -hex 32`            |
| `MEILI_MASTER_KEY`                | Required in production. `openssl rand -hex 16`         |
| `PUBLIC_TENANT_SLUG`              | Tenant slug used by the public site (default `test-tenant`) |
| `S3_PUBLIC_ENDPOINT`              | Public URL of the MinIO service (e.g. `https://minio.cms.example.com`) — required for browser media uploads |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | **Rotate** `minioadmin/minioadmin` (MinIO is internet-facing in prod) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Match the rotated MinIO creds above                    |

Everything else (worker concurrency, S3 region/bucket, email provider creds,
backup retention) is hardcoded in `docker-compose.yml`. Email is configured
post-deploy via **admin Settings → Email** (encrypted in the DB).

#### Connecting an external frontend or mobile client

The default starter does **not** surface `CORS_ALLOWED_ORIGINS` — admin and web
reach the API same-origin (admin via nginx, web via Nitro proxy), so no
cross-origin allowance is needed. If you later connect a separate frontend or
mobile app to this API, re-enable CORS:

1. In `docker-compose.yml`, under the `api` service's `environment:` block,
   add: `CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}`
2. In Coolify's env UI, set `CORS_ALLOWED_ORIGINS` to a comma-separated list of
   the origins you want to allow (e.g. `https://app.example.com,https://m.example.com`).
3. Redeploy.

### 4. Assign domains (Coolify UI → service → Domains)

| Service | Container port | Domain field value (`:port` suffix matters!) |
| ------- | -------------- | -------------------------------------------- |
| admin   | 80             | `https://admin.cms.example.com`              |
| api     | 3000           | `https://api.cms.example.com:3000`           |
| web     | 3001           | `https://cms.example.com:3001`               |
| minio   | 9000           | `https://minio.cms.example.com:9000`         |

The `:port` suffix is **mandatory** for any service not on port 80 —
Coolify's Traefik defaults to port 80 otherwise → HTTP 502.

The six internal services (`postgres`, `pgbouncer`, `dragonfly`,
`meilisearch`, `minio-setup`, `db-migrate`) carry `coolify.managed=true` +
`traefik.enable=false` labels in `docker-compose.yml`, so current Coolify
versions hide them from the Domains UI automatically. If your Coolify
version still shows them, **leave the domain field empty** — they stay
internal to the compose network and have no public surface.

### 5. Deploy

Click **Deploy**. First build is ~5-10 minutes; subsequent builds use
BuildKit cache (~1-3 min).

What happens automatically (because of this starter's design):

- `db-migrate` one-shot applies all Drizzle migrations to a fresh
  Postgres → exits 0 before `api` / `worker` boot.
- Hitting the `admin` domain shows the **setup wizard** (empty DB).
  Fill it in to create the first super-admin + tenant.
- No manual migrate, no manual seed.

### 6. After the first deploy

In the admin, **Settings → Site Settings → Site URL**: paste the public
`web` Coolify domain (e.g. `https://cms.example.com`). This drives the
admin's "Preview" buttons and outbound email links.

---

## Producing your own starter zip (after you modify the source)

This zip ships `scripts/export-starter.mjs` and the
`"export:starter"` script in `package.json`. To package your own
modified copy as a fresh starter for another install:

```bash
git init && git add . && git commit -m "initial"   # one-time: zip has no .git
pnpm install
pnpm export:starter
```

That writes `out/cms-starter.zip` with your changes, a fresh `.env` (new
random secrets), and an updated `STARTER-README.md`. See the source repo's
`README.md` → "Producing a starter zip" for the full reference.

## Going to production

- Rotate `PREVIEW_TOKEN_SECRET` and `WEBHOOK_SECRET_ENCRYPTION_KEY` in `.env`.
- Set `MEILI_MASTER_KEY` and switch `MEILI_ENV` to `production` in
  `docker-compose.yml`.
- Replace MinIO credentials, or swap to AWS S3 / Garage via the `S3_*` vars.
- Configure an email provider (`EMAIL_PROVIDER` + provider creds).
- See `README.md` for the full reference.
