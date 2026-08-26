# syntax=docker/dockerfile:1.7
# Build context must be the repo root (pnpm workspace).
#   docker build -f apps/api/Dockerfile -t cms-api .
# Or via compose: `docker compose build api`.

# ─── Stage 1 — deps ────────────────────────────────────────────────────────────
# Node 22 (current LTS) is required: pnpm@11.x imports node:sqlite, a Node 22+
# built-in. Node 20 fails install with ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite.
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json turbo.json ./
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/email/package.json packages/email/
COPY packages/editor/package.json packages/editor/
COPY packages/queue/package.json packages/queue/
COPY packages/search/package.json packages/search/
COPY packages/types/package.json packages/types/
# @cms/blocks is a workspace:* dep of the API; @cms/theme-kit is the build-time
# theme gate. Both were previously omitted here — tolerated because the builder
# stage's `COPY packages/` re-includes them, but listing them keeps the deps
# stage honest under --frozen-lockfile and ensures their tooling is installed.
COPY packages/blocks/package.json packages/blocks/
COPY packages/theme-kit/package.json packages/theme-kit/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Stage 2 — builder ─────────────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /repo

COPY packages/ packages/
COPY apps/api/ apps/api/

RUN pnpm turbo run build --filter=@cms/api...

# Intentionally no `pnpm prune --prod` here:
#   - pnpm 11.x's prune is a destructive purge+reinstall, which breaks the
#     pnpm-workspace symlinks under apps/api/node_modules/@cms/* that this
#     image relies on at runtime. The api crashes with
#     ERR_MODULE_NOT_FOUND for '@cms/config' after a pruned reinstall.
#   - Keeping devDependencies in the runner adds ~50MB to the image, which
#     is acceptable. Switch to `pnpm deploy` if the size becomes an issue.

# ─── Stage 3 — runner ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /repo

ENV NODE_ENV=production


COPY --from=builder /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/api/package.json apps/api/package.json
COPY --from=builder /repo/apps/api/dist apps/api/dist
COPY --from=builder /repo/apps/api/node_modules apps/api/node_modules
# Source + one-off scripts ship too so post-deploy DB tasks can run inside the
# container (no separate migrate/seed image). drizzle-kit (in packages/db) and
# tsx (in apps/api) are already present because the build doesn't prune devDeps.
# The seed scripts import ../src/services/password.js, hence src/ is needed.
#   migrate: cd packages/db && node_modules/.bin/drizzle-kit migrate
#   seed:    cd apps/api   && node_modules/.bin/tsx scripts/seed-test-admin.ts
COPY --from=builder /repo/apps/api/src apps/api/src
COPY --from=builder /repo/apps/api/scripts apps/api/scripts
# Seed fixtures (apps/api/fixtures/<name>/*.json) ship so the post-deploy one-shot
#   docker compose run --rm api pnpm --filter @cms/api seed:fixtures -- <name> --tenant=<slug>
# can load starter content against the deployed DB — the seeder reads these files.
COPY --from=builder /repo/apps/api/fixtures apps/api/fixtures

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
