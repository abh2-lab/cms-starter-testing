# syntax=docker/dockerfile:1.7
# Build context must be the repo root (pnpm workspace).
#   docker build -f apps/admin/Dockerfile -t cms-admin .
# Or via compose: `docker compose build admin`.
#
# Runtime: nginx serves the built Vite SPA, with /api/* reverse-proxied to the
# `api` service so the same-origin session cookie (Path=/, SameSite=Lax) keeps
# working without CORS — same shape as the Vite dev proxy in apps/admin/vite.config.ts.

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

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Stage 2 — builder ─────────────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /repo

# Admin only needs its own source + the editor workspace package it imports.
COPY packages/ packages/
COPY apps/admin/ apps/admin/

RUN pnpm turbo run build --filter=@cms/admin...

# ─── Stage 3 — runner ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# Drop the default site so our config is the only server block.
RUN rm /etc/nginx/conf.d/default.conf

COPY --from=builder /repo/apps/admin/dist /usr/share/nginx/html
COPY apps/admin/nginx.conf /etc/nginx/conf.d/admin.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
