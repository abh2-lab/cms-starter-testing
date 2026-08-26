---
title: Getting started
order: 1
---

# Getting started

This is the developer documentation for the CMS. It explains how the pieces fit
together and how to work with the public **Nuxt** site, the **admin**
dashboard, and the shared **theme** that renders content.

## The moving parts

The repo is a pnpm + Turborepo monorepo.

| Path | What it is |
| --- | --- |
| `apps/web` | The public site — **Nuxt 4**, SSR + ISR. This is where the **theme** lives. |
| `apps/admin` | The admin dashboard — **Vue 3 + Vite** SPA (you're looking at it). |
| `apps/api` | The backend — **Fastify** + PostgreSQL. The single source of truth. |
| `apps/worker` | Background jobs (image variants, view-count rollups) via BullMQ. |
| `packages/blocks` | Code-defined **block + template registry** (metadata + data loaders). |
| `packages/db` | Drizzle ORM schema + migrations. |
| `packages/types`, `editor`, `email`, `queue`, `search` | Shared building blocks. |

## How data flows

```text
Admin (Vue SPA)  ──writes──▶   Fastify API + Postgres   ◀──reads──  Nuxt site (theme)
   /api/admin/*                  (single source)                     /api/public/*
```

Everything goes through the API. The admin writes content via `/api/admin/*`
(session-cookie auth); the public Nuxt site reads it via `/api/public/*`
(anonymous, cached). The Nuxt app **owns no data** — it's pure render logic.

## Key idea: the theme is code

There is no "page builder builds the layout from scratch" model. Instead:

- Developers ship **templates** and **blocks** as code (in the theme + in
  `packages/blocks`).
- Editors create **content** that is rendered *through* those templates, and
  only edit the labels/sources a template exposes.

See [The theme contract](?doc=theme-contract) for the templates a theme must
provide, [Blocks](?doc=blocks) for the block system, and
[Reading CMS data in Nuxt](?doc=nuxt-data) for how the public site fetches and
renders everything.

## Running locally

Use **Hybrid dev**: backing services (Postgres, Redis, Meilisearch, S3) in
Docker; the apps from source.

```bash
# from the repo root
pnpm install
pnpm dev            # turbo runs all apps; or target one:
pnpm --filter @cms/admin dev   # admin → http://localhost:5173
pnpm --filter @cms/web dev     # site  → http://localhost:3001
pnpm --filter @cms/api dev     # api   → http://localhost:3000
```
