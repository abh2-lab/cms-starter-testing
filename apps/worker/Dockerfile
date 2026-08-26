# syntax=docker/dockerfile:1.7
# Build context must be the repo root (pnpm workspace).
#   docker build -f apps/worker/Dockerfile -t cms-worker .
# Or via compose: `docker compose build worker`.

# ─── Stage 1 — deps ────────────────────────────────────────────────────────────
# Cacheable layer: just installs node_modules. Re-runs only when the lockfile
# or any package.json changes.
# Node 22 (current LTS) is required: pnpm@11.x imports node:sqlite, a Node 22+
# built-in. Node 20 fails install with ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite.
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Match the root packageManager field exactly (package.json:6).
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

WORKDIR /repo

# Workspace metadata + every package.json — but no source yet.
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
# Compile the worker and its transitive @cms/* deps. The trailing `...` on the
# turbo filter pulls in @cms/config → @cms/db → @cms/queue → @cms/search → @cms/types
# in topological order automatically.
FROM deps AS builder

WORKDIR /repo

# Copy source for the worker + every internal package. Frontend app sources
# (admin/web) are intentionally NOT copied — the worker doesn't need them.
COPY packages/ packages/
COPY apps/worker/ apps/worker/

RUN pnpm turbo run build --filter=@cms/worker...

# Intentionally no `pnpm prune --prod` here:
#   - pnpm 11.x's prune is a destructive purge+reinstall, which breaks the
#     pnpm-workspace symlinks under apps/worker/node_modules/@cms/* that this
#     image relies on at runtime. The worker crashes with
#     ERR_MODULE_NOT_FOUND for '@cms/config' after a pruned reinstall.
#   - Keeping devDependencies in the runner adds ~50MB to the image, which
#     is acceptable. Switch to `pnpm deploy` if the size becomes an issue.

# ─── Stage 3 — runner ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /repo

ENV NODE_ENV=production


# Preserve the workspace layout from the builder so pnpm's symlinks under
# node_modules resolve at runtime. Frontend apps are excluded.
COPY --from=builder /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/worker/package.json apps/worker/package.json
COPY --from=builder /repo/apps/worker/dist apps/worker/dist
COPY --from=builder /repo/apps/worker/node_modules apps/worker/node_modules

# `node` is the preconfigured non-root user (uid 1000) in the official image.
USER node

EXPOSE 3100

# Healthcheck targets /ready (workers have called waitUntilReady), not /health
# (which always 200s once the http server boots). Node 20 ships fetch natively.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# dist/src/index.js (not dist/index.js): worker/tsconfig.json sets rootDir="."
# and includes both src/ and test/, so TypeScript preserves the src/ prefix in
# the output. The api compiles to a flat dist/ because its rootDir is "./src".
CMD ["node", "apps/worker/dist/src/index.js"]
