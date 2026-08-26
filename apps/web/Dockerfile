# syntax=docker/dockerfile:1.7
# Build context must be the repo root (pnpm workspace).
#   docker build -f apps/web/Dockerfile -t cms-web .
# Or via compose: `docker compose build web`.
#
# Nuxt 4 + Nitro emits a self-contained server bundle at apps/web/.output. The
# site reaches the API SAME-ORIGIN through a Nitro `/api/public/**` proxy route
# rule (apps/web/nuxt.config.ts). That rule's target is baked at build time from
# NUXT_API_PROXY_TARGET (default http://api:3000, the compose service name), so
# there's no runtime API URL or CORS to configure.

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
# @cms/blocks (the theme's block contracts) + @cms/theme-kit (the build-time
# theme gate): required so `pnpm verify:theme:structure` in the builder stage can
# install + run its tsx CLI, and to keep --frozen-lockfile honest.
COPY packages/blocks/package.json packages/blocks/
COPY packages/theme-kit/package.json packages/theme-kit/

# `pnpm install` triggers @cms/web's `postinstall: nuxt prepare`, which needs
# the web source to be present. We skip postinstall scripts here so this stage
# can stay source-free and remain cacheable on lockfile-only changes; the
# `nuxt build` in the builder stage runs `nuxt prepare` implicitly.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ─── Stage 2 — builder ─────────────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /repo

# Bake the Nitro proxy target + production mode into the build. Route rules are
# static, so these are read by nuxt.config.ts at build time, not runtime.
# Override the target with --build-arg NUXT_API_PROXY_TARGET=... if the API
# service is reachable under a different in-network name.
ARG NUXT_API_PROXY_TARGET=http://api:3000
ENV NUXT_API_PROXY_TARGET=${NUXT_API_PROXY_TARGET}
ENV NODE_ENV=production

COPY packages/ packages/
COPY apps/web/ apps/web/

# Build-time theme gate (Phase 2): structural coherence of blocks/templates/parts
# ↔ the theme's render registry — catches key drift, invalid metas, and loaders
# that throw. A broken theme fails the image build HERE, so it can never reach the
# live site. Runs before the (slower) Nuxt build so failures surface fast.
RUN pnpm verify:theme:structure

RUN pnpm turbo run build --filter=@cms/web...

# ─── Stage 3 — runner ──────────────────────────────────────────────────────────
# Nitro's node-server preset produces a self-contained .output dir with its own
# node_modules. No pnpm runtime needed.
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
# Nitro defaults to PORT/HOST. Bind 0.0.0.0 so the container is reachable from
# the compose network and the Coolify reverse proxy.
ENV NITRO_PORT=3001
ENV NITRO_HOST=0.0.0.0
ENV PORT=3001
ENV HOST=0.0.0.0

COPY --from=builder /repo/apps/web/.output ./

USER node

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
