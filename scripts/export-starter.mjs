#!/usr/bin/env node
// Build a fresh-start zip of this monorepo at HEAD that a user can unzip
// and run with a single `docker compose up`.
//
//   pnpm export:starter            # refuses if working tree is dirty
//   pnpm export:starter --allow-dirty   # exports HEAD anyway (uncommitted changes are NOT included)
//
// Output: ./out/cms-starter.zip
//
//   pnpm export:clone              # alias for: export-starter.mjs --with-data
//
// --with-data produces an AS-IS CLONE instead of a blank starter: it snapshots
// the running install's Postgres (snapshot/postgres.dump) and media bucket
// (snapshot/media/), carries the install's REAL secrets (so the cloned DB's
// encrypted columns still decrypt), and pins PUBLIC_TENANT_SLUG to the dumped
// tenant. The bundled docker-compose restore one-shots load that snapshot on
// first boot (no setup wizard). Output: ./out/cms-clone.zip
//
// Strategy:
//   1. `git archive --format=tar HEAD | tar -x` into a temp staging dir.
//      `git archive` honors `.gitattributes export-ignore` (dev-only paths
//      like apps/e2e/, docs/, .claude/ are stripped), reads from the git
//      index (so host autocrlf settings don't corrupt scripts in the zip),
//      and preserves file modes. We use tar (not zip) for the intermediate
//      because system `tar` is universally available; Windows 10+ ships
//      bsdtar built-in.
//   2. Drop two generated files into the staging dir:
//        cms-starter/.env             — fresh random secrets per export
//        cms-starter/STARTER-README.md — first-run instructions
//   3. Pack the staging dir into out/cms-starter.zip via `archiver`.

import { execSync, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'out');

const allowDirty = process.argv.includes('--allow-dirty');
// --with-data → as-is clone (current DB + media + real secrets). Otherwise the
// default blank starter (fresh secrets, empty DB, first-boot setup wizard).
const withData = process.argv.includes('--with-data');

const PREFIX = withData ? 'cms-clone' : 'cms-starter';
const OUT_PATH = join(OUT_DIR, withData ? 'cms-clone.zip' : 'cms-starter.zip');

// ─── as-is clone helpers (only used when --with-data) ───────────────────────

/** Minimal .env parser: KEY=VALUE lines, ignores comments/blanks, strips quotes. */
function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function dockerCompose(args, opts = {}) {
  return spawnSync('docker', ['compose', ...args], { cwd: REPO_ROOT, ...opts });
}

/** pg_dump the running Postgres (via docker compose exec) into snapshot/postgres.dump. */
function snapshotPostgres(snapshotDir) {
  console.log('→ pg_dump (docker compose exec postgres) → snapshot/postgres.dump');
  const dump = dockerCompose(
    ['exec', '-T', 'postgres', 'pg_dump', '--format=custom', '--compress=9', '-U', 'postgres', 'cms'],
    { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1024 * 1024 * 1024 },
  );
  if (dump.status !== 0 || !dump.stdout || dump.stdout.length === 0) {
    console.error(
      [
        '',
        'export:clone: could not dump the database.',
        'The clone snapshots the LIVE Postgres via `docker compose exec postgres pg_dump`.',
        'Make sure the backing services are running first:  pnpm dev:services',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  writeFileSync(join(snapshotDir, 'postgres.dump'), dump.stdout);
  console.log(`  postgres.dump — ${(dump.stdout.length / 1024 / 1024).toFixed(2)} MB`);
}

/**
 * Mirror the cms-media bucket out of the running MinIO into snapshot/media/.
 * Uses a throwaway mc helper container + `docker cp` (no host bind mount — that
 * avoids Windows path-translation pitfalls).
 */
function snapshotMedia(snapshotDir, s3Key, s3Secret) {
  const mediaDir = join(snapshotDir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const name = 'cms-media-export';
  console.log('→ mc mirror cms-media bucket → snapshot/media/');
  spawnSync('docker', ['rm', '-f', name], { cwd: REPO_ROOT, stdio: 'ignore' });
  const script = `mkdir -p /export && mc alias set local http://minio:9000 ${s3Key} ${s3Secret} && mc mirror local/cms-media /export`;
  const mirror = spawnSync(
    'docker',
    ['compose', 'run', '-T', '--no-deps', '--name', name, '--entrypoint', '/bin/sh', 'minio-setup', '-c', script],
    { cwd: REPO_ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (mirror.status !== 0) {
    spawnSync('docker', ['rm', '-f', name], { cwd: REPO_ROOT, stdio: 'ignore' });
    console.error('export:clone: media mirror failed (is MinIO running?).');
    process.exit(1);
  }
  const cp = spawnSync('docker', ['cp', `${name}:/export/.`, mediaDir], { cwd: REPO_ROOT, stdio: 'inherit' });
  spawnSync('docker', ['rm', '-f', name], { cwd: REPO_ROOT, stdio: 'ignore' });
  if (cp.status !== 0) {
    console.warn('  (no media objects copied — the bucket may be empty)');
  }
}

/** Fallback: read the active tenant slug straight from the running DB. */
function queryTenantSlug() {
  const res = dockerCompose(
    ['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'cms', '-tAc',
      'select slug from tenants where is_active = true order by created_at limit 1'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (res.status !== 0 || !res.stdout) return '';
  return res.stdout.toString().trim();
}

function buildCloneEnv(carry, tenantSlug) {
  return `# Generated by \`pnpm export:clone\` — an AS-IS CLONE of a running install.
# This carries the ORIGINAL install's secrets so the cloned database's encrypted
# columns (webhook / storage / email secrets) still decrypt. Rotating
# WEBHOOK_SECRET_ENCRYPTION_KEY here would corrupt them. Treat this file — and the
# whole bundle, including snapshot/ — as SECRET: it holds real data and real keys.

NODE_ENV=development
LOG_LEVEL=info

DATABASE_URL=postgres://postgres:postgres@localhost:6432/cms
DIRECT_DATABASE_URL=postgres://postgres:postgres@localhost:5432/cms

REDIS_URL=redis://localhost:6379

MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=${carry.MEILI_MASTER_KEY || randomBytes(16).toString('hex')}

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=cms-media
S3_ACCESS_KEY_ID=${carry.S3_ACCESS_KEY_ID || 'minioadmin'}
S3_SECRET_ACCESS_KEY=${carry.S3_SECRET_ACCESS_KEY || 'minioadmin'}
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_ENDPOINT=

# Carried over from the source install — DO NOT regenerate for this clone.
PREVIEW_TOKEN_SECRET=${carry.PREVIEW_TOKEN_SECRET || randomBytes(32).toString('hex')}
WEBHOOK_SECRET_ENCRYPTION_KEY=${carry.WEBHOOK_SECRET_ENCRYPTION_KEY}

EMAIL_PROVIDER=stub
EMAIL_FROM=noreply@cms.local

# The real tenant slug from the dumped database — public routes resolve this to
# the tenant row, so it MUST match the data.
PUBLIC_TENANT_SLUG=${tenantSlug}

# This clone runs the full Decode theme (all blocks).
ACTIVE_THEME=${carry.ACTIVE_THEME || 'decode'}
`;
}

function buildCloneReadme(tenantSlug) {
  return `# CMS — as-is clone (first-run guide)

Produced by \`pnpm export:clone\`. Unlike the blank starter, this is an AS-IS
CLONE of a running install: it bundles the database (\`snapshot/postgres.dump\`),
uploaded media (\`snapshot/media/\`), and the install's real secrets. On first
boot the stack restores that data automatically — there is **no setup wizard**.

> ⚠️ Treat this whole bundle as a SECRET. It contains real content and the real
> encryption keys. Don't share it or push it to a public repo.

## 1. Start the stack (local)

\`\`\`bash
docker compose up -d --build
\`\`\`

First boot runs, in order: \`db-restore\` (loads \`snapshot/postgres.dump\` into the
empty DB) → \`db-migrate\` (applies any newer migrations; a no-op for a matching
snapshot) → \`media-restore\` (mirrors \`snapshot/media/\` into the bucket) →
\`meili-reindex\` (rebuilds the search index). Then api / admin / web come up.

\`\`\`bash
docker compose logs -f db-restore db-migrate media-restore meili-reindex
\`\`\`

## 2. Open it

- Admin: http://localhost:8080 — your EXISTING login works (no wizard).
- Public site: http://localhost:3001 — your existing content + media render.

The tenant slug baked into \`.env\` is \`${tenantSlug}\` (matches the dump).

## 3. Deploy this clone to Coolify

Coolify ignores the bundled \`.env\`, so you MUST set the SAME carried-over values
in Coolify's env UI — otherwise the cloned database's encrypted columns won't
decrypt:

| Variable | Value |
| --- | --- |
| \`WEBHOOK_SECRET_ENCRYPTION_KEY\` | the exact value from this \`.env\` (do NOT regenerate) |
| \`PREVIEW_TOKEN_SECRET\` | the exact value from this \`.env\` |
| \`MEILI_MASTER_KEY\` | the exact value from this \`.env\` |
| \`PUBLIC_TENANT_SLUG\` | \`${tenantSlug}\` |
| \`S3_PUBLIC_ENDPOINT\` | public URL of MinIO (for browser media) |

Push the unzipped bundle (including \`snapshot/\`) to a git repo and point a
Coolify Docker-Compose resource at it. The restore one-shots run on the first
deploy exactly as above; the empty-DB guard means later redeploys never clobber
live data.

> \`snapshot/\` can be large (it holds all media) and travels in the git repo you
> push to Coolify.

## 4. Re-cloning after changes

From the source install's repo root, with the stack running:

\`\`\`bash
pnpm export:clone
\`\`\`

For a fresh BLANK install (wizard on first boot) instead, use
\`pnpm export:starter\` — see the source repo's \`README.md\`.
`;
}

/** Runs the data snapshot and returns the clone-specific { env, readme }. */
function produceCloneArtifacts(stagingDir) {
  const carry = parseEnvFile(join(REPO_ROOT, '.env'));
  if (!carry.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    console.error(
      [
        '',
        'export:clone: WEBHOOK_SECRET_ENCRYPTION_KEY not found in ./.env.',
        "An as-is clone must carry the install's real encryption key, or the cloned",
        "database's encrypted columns (webhook / storage / email secrets) can't be",
        'decrypted. Run export:clone from the install repo root (where .env lives).',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  const snapshotDir = join(stagingDir, 'snapshot');
  mkdirSync(snapshotDir, { recursive: true });
  snapshotPostgres(snapshotDir);
  snapshotMedia(
    snapshotDir,
    carry.S3_ACCESS_KEY_ID || 'minioadmin',
    carry.S3_SECRET_ACCESS_KEY || 'minioadmin',
  );
  const tenantSlug =
    carry.PUBLIC_TENANT_SLUG && carry.PUBLIC_TENANT_SLUG.length > 0
      ? carry.PUBLIC_TENANT_SLUG
      : queryTenantSlug();
  if (!tenantSlug) {
    console.error(
      'export:clone: could not determine the tenant slug (set PUBLIC_TENANT_SLUG in .env).',
    );
    process.exit(1);
  }
  return { env: buildCloneEnv(carry, tenantSlug), readme: buildCloneReadme(tenantSlug) };
}

function gitStdout(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
    .toString()
    .trim();
}

// 1. Refuse to export from a dirty tree unless explicitly allowed.
const dirty = gitStdout('git status --porcelain');
if (dirty && !allowDirty) {
  console.error(
    [
      'export-starter: working tree has uncommitted changes:',
      '',
      dirty,
      '',
      'These will NOT be included — `git archive` reads from HEAD only.',
      'Commit your changes first, or re-run with --allow-dirty to export HEAD anyway.',
    ].join('\n'),
  );
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const stagingRoot = mkdtempSync(join(tmpdir(), 'cms-starter-'));
const stagingDir = join(stagingRoot, PREFIX);
mkdirSync(stagingDir, { recursive: true });

// 2. git archive --format=tar HEAD | tar -x -C stagingRoot
//    spawnSync with stdio piping handles the cross-process pipe on Windows too.
console.log(`→ git archive HEAD → ${stagingDir}`);
const gitArchive = spawnSync(
  'git',
  ['archive', '--format=tar', `--prefix=${PREFIX}/`, 'HEAD'],
  { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 512 * 1024 * 1024 },
);
if (gitArchive.status !== 0) {
  console.error('git archive failed');
  process.exit(gitArchive.status ?? 1);
}
// `-f -` is REQUIRED on Windows. bsdtar (the `tar` Windows 10+ ships)
// defaults to a tape device `\\.\tape0` when no `-f` is given — a 1970s
// Unix default that fails on modern hosts. GNU tar (Git Bash) auto-detects
// stdin, but bsdtar doesn't. `-f -` says "read from stdin" explicitly and
// is portable across both.
const untar = spawnSync('tar', ['-xf', '-', '-C', stagingRoot], {
  input: gitArchive.stdout,
  stdio: ['pipe', 'inherit', 'inherit'],
  maxBuffer: 512 * 1024 * 1024,
});
if (untar.status !== 0) {
  console.error('tar extraction failed');
  process.exit(untar.status ?? 1);
}

// 2b. Strip hardcoded `container_name:` lines from docker-compose.yml so the
//     unzipped starter doesn't collide with a host already running the source
//     repo's stack (or another extracted starter). Without container_name set,
//     Compose auto-names containers as `<project>-<service>-<index>` where the
//     project name defaults to the unzipped directory (cms-starter → containers
//     like `cms-starter-postgres-1`). The source repo keeps its original
//     `container_name: cms-postgres` etc. untouched.
const composePath = join(stagingDir, 'docker-compose.yml');
const composeOriginal = readFileSync(composePath, 'utf8');
const composeStripped = composeOriginal
  .split(/\r?\n/)
  .filter((line) => !/^\s*container_name:\s/.test(line))
  .join('\n');
writeFileSync(composePath, composeStripped, 'utf8');

// 3. Generate fresh secrets + write the two extra files into the staging dir.
const previewSecret = randomBytes(32).toString('hex');
const webhookKey = randomBytes(32).toString('hex');
// Meilisearch master key — required because the api/worker containers
// hardcode NODE_ENV=production, and @cms/config's Zod validation rejects an
// empty MEILI_MASTER_KEY in production. 16 bytes = 32 hex chars, well above
// Meilisearch's documented ≥16-char floor.
const meiliKey = randomBytes(16).toString('hex');

const envContent = `# Generated by \`pnpm export:starter\` on a fresh install of the CMS.
# These values let \`docker compose up\` boot cleanly without further edits.
# The *_SECRET / *_KEY values were generated with crypto.randomBytes — rotate
# before deploying to production (they're random but visible to anyone who
# has a copy of this starter zip).

NODE_ENV=development
LOG_LEVEL=info

# Database — these point at the host port mappings in docker-compose.override.yml.
# Only used if you later run apps from source (hybrid dev). The api/worker
# containers themselves get container-network URLs from docker-compose.yml.
DATABASE_URL=postgres://postgres:postgres@localhost:6432/cms
DIRECT_DATABASE_URL=postgres://postgres:postgres@localhost:5432/cms

REDIS_URL=redis://localhost:6379

MEILI_HOST=http://localhost:7700
# Required: api/worker run NODE_ENV=production inside docker compose and
# @cms/config's Zod schema rejects an empty MEILI_MASTER_KEY in that mode.
MEILI_MASTER_KEY=${meiliKey}

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=cms-media
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_ENDPOINT=

# Required: rotate these for production use.
PREVIEW_TOKEN_SECRET=${previewSecret}
WEBHOOK_SECRET_ENCRYPTION_KEY=${webhookKey}

# Email — defaults to stub (logs to worker stdout). See .env.example for
# SMTP / Resend / Sendinblue / HTTP options.
EMAIL_PROVIDER=stub
EMAIL_FROM=noreply@cms.local

# Single-publisher tenant slug. The setup wizard creates a tenant with this
# slug, and the public Nuxt site at :3001 resolves it.
PUBLIC_TENANT_SLUG=test-tenant

# Blank starter runs the generic 'basic' theme: the admin block palette shows
# only the core/global blocks, not the Decode-specific ones. Rename to your own
# theme once you build one (any name other than basic/core exposes all blocks).
ACTIVE_THEME=basic
`;

const readmeContent = `# CMS Starter — first-run guide

This zip is a fresh-start snapshot of the custom-hocalwire-CMS monorepo,
produced by \`pnpm export:starter\`. Empty database, no demo content, all
services dockerized.

## 1. Start the stack

\`\`\`bash
docker compose up -d --build
\`\`\`

First boot takes ~60 seconds (Docker pulls base images, builds the api,
admin, worker, and web containers, then the one-shot \`db-migrate\` service
applies all Drizzle migrations to the freshly-initialised Postgres).

Tail logs while you wait:

\`\`\`bash
docker compose logs -f db-migrate api admin web
\`\`\`

Once \`docker compose ps\` shows \`db-migrate\` as \`Exit 0\` and the rest as
\`healthy\`, you're good.

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
\`http://localhost:3001\` (or your production URL). Without this:

- The admin's "Preview" buttons can't link to the public site.
- Outbound emails (review notifications, etc.) won't include working links.

## Reaching the rest of the stack locally

| Service       | URL                              | Notes                            |
| ------------- | -------------------------------- | -------------------------------- |
| Admin         | http://localhost:8080            | Setup wizard / dashboard         |
| Public site   | http://localhost:3001            | Nuxt 4 SSR                       |
| API           | http://localhost:3000            | Health: \`/health\`, docs: \`/docs\` |
| Worker        | http://localhost:3100            | Readiness: \`/ready\`              |
| Postgres      | localhost:5432                   | postgres / postgres              |
| PgBouncer     | localhost:6432                   | postgres / postgres              |
| Dragonfly     | localhost:6379                   | Redis-compatible                 |
| Meilisearch   | http://localhost:7700            |                                  |
| MinIO         | http://localhost:9000            | minioadmin / minioadmin          |
| MinIO console | http://localhost:9001            |                                  |

### Container names in \`docker ps\`

Containers are auto-named from the unzipped directory \`cms-starter\` →
\`cms-starter-postgres-1\`, \`cms-starter-minio-1\`, \`cms-starter-api-1\`,
etc. This keeps the starter stack from colliding with other Docker Compose
projects on the same host (e.g. the source CMS repo running in hybrid dev).
Rename the directory before \`docker compose up\` to scope the names
differently, e.g. \`mv cms-starter my-publisher\` → containers become
\`my-publisher-postgres-1\` and friends.

## AI theme authoring

This starter ships an AI theme-authoring kit. Open the repo in any coding
assistant (Claude Code, Cursor, Windsurf, Agent SDK) and point it at **AGENTS.md**
— it can turn a mock HTML design into a working theme (blocks, templates/parts,
fixtures) with you doing final QA. Always author in hybrid/dev, never on the live
container. After deploying, seed your starter content into the live DB:

    docker compose run --rm api pnpm --filter @cms/api seed:fixtures -- <name> --tenant=<PUBLIC_TENANT_SLUG>

## Modifying the public Nuxt app

Source lives in \`apps/web/\`. To iterate quickly with hot reload, switch
to hybrid dev:

\`\`\`bash
docker compose stop api admin web worker     # keep backing services running
pnpm install
pnpm dev                                      # runs all four apps from source
\`\`\`

Admin → http://localhost:5173 (Vite dev), api → http://localhost:3000,
public → http://localhost:3001.

## Resetting to a blank state

\`\`\`bash
docker compose down -v   # also wipes postgres-data, dragonfly-data, etc.
docker compose up -d
\`\`\`

The setup wizard reappears because the DB is empty again.

## Deploying to Coolify

This is the same \`docker-compose.yml\` Coolify reads natively — the starter
is already production-shaped. Outline:

### 1. Push the unzipped starter to a git repo

Coolify deploys from git, not zip uploads. From inside this directory:

\`\`\`bash
git init && git add . && git commit -m "initial"
git remote add origin <your-git-remote>
git push -u origin main
\`\`\`

### 2. Create the Coolify resource

In Coolify: **New Resource → Docker Compose**, point it at the repo above,
branch \`main\`, compose file \`docker-compose.yml\` (root), build pack
**Docker Compose** (NOT Nixpacks).

### 3. Set env vars in Coolify's UI (not via this \`.env\`)

The \`.env\` shipped in this zip is for local \`docker compose up\` and is
ignored by Coolify. Set these in Coolify's UI under the resource's env
section:

| Variable                          | Notes                                                  |
| --------------------------------- | ------------------------------------------------------ |
| \`PREVIEW_TOKEN_SECRET\`            | Required, ≥32 chars. \`openssl rand -hex 32\`            |
| \`WEBHOOK_SECRET_ENCRYPTION_KEY\`   | Required, ≥32 chars. \`openssl rand -hex 32\`            |
| \`MEILI_MASTER_KEY\`                | Required in production. \`openssl rand -hex 16\`         |
| \`PUBLIC_TENANT_SLUG\`              | Tenant slug used by the public site (default \`test-tenant\`) |
| \`S3_PUBLIC_ENDPOINT\`              | Public URL of the MinIO service (e.g. \`https://minio.cms.example.com\`) — required for browser media uploads |
| \`MINIO_ROOT_USER\` / \`MINIO_ROOT_PASSWORD\` | **Rotate** \`minioadmin/minioadmin\` (MinIO is internet-facing in prod) |
| \`S3_ACCESS_KEY_ID\` / \`S3_SECRET_ACCESS_KEY\` | Match the rotated MinIO creds above                    |

Everything else (worker concurrency, S3 region/bucket, email provider creds,
backup retention) is hardcoded in \`docker-compose.yml\`. Email is configured
post-deploy via **admin Settings → Email** (encrypted in the DB).

#### Connecting an external frontend or mobile client

The default starter does **not** surface \`CORS_ALLOWED_ORIGINS\` — admin and web
reach the API same-origin (admin via nginx, web via Nitro proxy), so no
cross-origin allowance is needed. If you later connect a separate frontend or
mobile app to this API, re-enable CORS:

1. In \`docker-compose.yml\`, under the \`api\` service's \`environment:\` block,
   add: \`CORS_ALLOWED_ORIGINS: \${CORS_ALLOWED_ORIGINS}\`
2. In Coolify's env UI, set \`CORS_ALLOWED_ORIGINS\` to a comma-separated list of
   the origins you want to allow (e.g. \`https://app.example.com,https://m.example.com\`).
3. Redeploy.

### 4. Assign domains (Coolify UI → service → Domains)

| Service | Container port | Domain field value (\`:port\` suffix matters!) |
| ------- | -------------- | -------------------------------------------- |
| admin   | 80             | \`https://admin.cms.example.com\`              |
| api     | 3000           | \`https://api.cms.example.com:3000\`           |
| web     | 3001           | \`https://cms.example.com:3001\`               |
| minio   | 9000           | \`https://minio.cms.example.com:9000\`         |

The \`:port\` suffix is **mandatory** for any service not on port 80 —
Coolify's Traefik defaults to port 80 otherwise → HTTP 502.

The six internal services (\`postgres\`, \`pgbouncer\`, \`dragonfly\`,
\`meilisearch\`, \`minio-setup\`, \`db-migrate\`) carry \`coolify.managed=true\` +
\`traefik.enable=false\` labels in \`docker-compose.yml\`, so current Coolify
versions hide them from the Domains UI automatically. If your Coolify
version still shows them, **leave the domain field empty** — they stay
internal to the compose network and have no public surface.

### 5. Deploy

Click **Deploy**. First build is ~5-10 minutes; subsequent builds use
BuildKit cache (~1-3 min).

What happens automatically (because of this starter's design):

- \`db-migrate\` one-shot applies all Drizzle migrations to a fresh
  Postgres → exits 0 before \`api\` / \`worker\` boot.
- Hitting the \`admin\` domain shows the **setup wizard** (empty DB).
  Fill it in to create the first super-admin + tenant.
- No manual migrate, no manual seed.

### 6. After the first deploy

In the admin, **Settings → Site Settings → Site URL**: paste the public
\`web\` Coolify domain (e.g. \`https://cms.example.com\`). This drives the
admin's "Preview" buttons and outbound email links.

---

## Producing your own starter zip (after you modify the source)

This zip ships \`scripts/export-starter.mjs\` and the
\`"export:starter"\` script in \`package.json\`. To package your own
modified copy as a fresh starter for another install:

\`\`\`bash
git init && git add . && git commit -m "initial"   # one-time: zip has no .git
pnpm install
pnpm export:starter
\`\`\`

That writes \`out/cms-starter.zip\` with your changes, a fresh \`.env\` (new
random secrets), and an updated \`STARTER-README.md\`. See the source repo's
\`README.md\` → "Producing a starter zip" for the full reference.

## Going to production

- Rotate \`PREVIEW_TOKEN_SECRET\` and \`WEBHOOK_SECRET_ENCRYPTION_KEY\` in \`.env\`.
- Set \`MEILI_MASTER_KEY\` and switch \`MEILI_ENV\` to \`production\` in
  \`docker-compose.yml\`.
- Replace MinIO credentials, or swap to AWS S3 / Garage via the \`S3_*\` vars.
- Configure an email provider (\`EMAIL_PROVIDER\` + provider creds).
- See \`README.md\` for the full reference.
`;

if (withData) {
  // As-is clone: snapshot the live DB + media into stagingDir/snapshot/ and
  // emit the clone-specific .env (carried secrets) + README. The blank-mode
  // envContent/readmeContent computed above are unused on this path.
  const clone = produceCloneArtifacts(stagingDir);
  writeFileSync(join(stagingDir, '.env'), clone.env, 'utf8');
  writeFileSync(join(stagingDir, 'STARTER-README.md'), clone.readme, 'utf8');
} else {
  writeFileSync(join(stagingDir, '.env'), envContent, 'utf8');
  writeFileSync(join(stagingDir, 'STARTER-README.md'), readmeContent, 'utf8');
}

// 3b. AI theme-authoring kit entry points. AGENTS.md ships natively (committed at
//     the repo root — not export-ignored). The source repo's CLAUDE.md / .claude/
//     / docs/ ARE export-ignored, so generate fresh per-client pointers that route
//     Claude Code (CLAUDE.md), Cursor (.cursor/rules), and Windsurf (.windsurfrules)
//     to AGENTS.md — cross-client reach can't rely on AGENTS.md alone.
const aiPointer = `# AI theme authoring

This repo ships an AI theme-authoring kit. To turn a mock HTML design into a
working theme (blocks, templates/parts, seed fixtures), read AGENTS.md in this
directory. It has the full loop, the pnpm commands (gen:block, gen:template,
verify:theme), the hard rules, and the authoring-vs-runtime boundary.

Quick start (always hybrid/dev — NEVER on the live container):

    pnpm install
    pnpm dev:services     # backing services in Docker
    pnpm dev              # apps from source: admin :5173, web :3001, api :3000
    # assistant: mock HTML -> pnpm gen:block / gen:template -> fill in -> fixtures
    pnpm verify:theme     # structure + content gate; loop until GREEN
    # preview http://localhost:3001, then do a human QA pass
`;
writeFileSync(join(stagingDir, 'CLAUDE.md'), aiPointer, 'utf8');
writeFileSync(join(stagingDir, '.windsurfrules'), aiPointer, 'utf8');
mkdirSync(join(stagingDir, '.cursor', 'rules'), { recursive: true });
writeFileSync(join(stagingDir, '.cursor', 'rules', 'ai-authoring.md'), aiPointer, 'utf8');

// 4. Pack the staging dir into the final zip.
console.log(`→ packing → ${OUT_PATH}`);
await new Promise((resolve, reject) => {
  const output = createWriteStream(OUT_PATH);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
  archive.on('warning', (err) => {
    console.warn(`archive warning: ${err.message}`);
  });

  archive.pipe(output);
  archive.directory(stagingDir, PREFIX);
  archive.finalize();
});

rmSync(stagingRoot, { recursive: true, force: true });

const sizeMb = (statSync(OUT_PATH).size / 1024 / 1024).toFixed(2);
const zipName = withData ? 'cms-clone.zip' : 'cms-starter.zip';
console.log('');
console.log(`Done — out/${zipName} (${sizeMb} MB)${withData ? '  [as-is clone]' : ''}`);
console.log('');
console.log('Try it:');
console.log(`  unzip out/${zipName} -d /tmp/${PREFIX}-test`);
console.log(`  cd /tmp/${PREFIX}-test/${PREFIX}`);
console.log('  docker compose up -d --build');
console.log(`  open http://localhost:8080${withData ? '   # your existing login — no setup wizard' : ''}`);
