# Local development → Live (Coolify): the standard workflow

This is the everyday routine for taking work you did on your own computer and
making it appear on the live site running on Coolify.

Read this first — it saves a lot of confusion.

---

## The one idea that explains everything

Your project has **two different kinds of "stuff"**, and each one travels to the
live site by a **different road**. Mixing them up is the usual cause of "why
isn't my change showing on live?"

| What you changed | Where it lives | How it reaches live |
|---|---|---|
| **Code** — blocks, templates, theme CSS, layout, logic, bug fixes (files in the repo) | Files, tracked by **git** | **Push to git** → Coolify rebuilds |
| **Content** — articles, pages, images, menus, site settings, theme tweaks made by clicking in the admin | The **database** | Create it **directly in the live admin** |
| **New database structure** — a new table or field that a code change needs | A **migration file** in the repo | Push the code, then run the migrate command **once** on live |

Plain-English version:

- **Code = git.** You push it, Coolify redeploys, it's live.
- **Content = live admin.** You write it straight on the live site. Your local
  database is only a testing sandbox — it is **not** meant to be copied up.
- **Migrations** are the one small bridge between the two, and only when the
  database *shape* changes.

---

## The everyday loop (code changes — the common case)

This covers things like the mobile/curve/type-scale fixes: they are **code**.

1. **Develop and test locally.**
   ```
   pnpm dev
   ```
   Preview at http://localhost:3001. Get it right here first.

2. **Commit.** (In this project, the assistant commits for you and never pushes.)

3. **See what you're about to ship** — a quick pre-flight so there are no
   surprises:
   ```
   git status
   git log origin/main..main --oneline
   ```
   The second line lists commits that are committed but **not pushed yet**.

4. **Push** (you do this — it needs your GitHub login):
   ```
   git push
   ```

5. **Deploy on Coolify.** If auto-deploy is on, Coolify starts rebuilding by
   itself when you push. If not, open the app in Coolify and click **Deploy**.
   Wait until every service is green (Running).

6. **Check the live site.** Hard-refresh the page (Ctrl+F5). Your code change
   should be there.

That's it. Most days you only do steps 1–6.

---

## The extra step: database migrations (only sometimes)

Coolify does **not** run migrations automatically. So if a code change adds a
new table or field, you must run the migration once, **after** the deploy.

**How you'll know:** the change adds a new file under `packages/db/` (the
migrations folder). If you're working with the assistant, it will tell you
plainly: "this one needs the migrate step on live."

**How to run it:** Coolify → your app → the **`api`** service → **Terminal**,
then:
```
cd /repo/packages/db && node_modules/.bin/drizzle-kit migrate
```
It's safe to run again if you're unsure — it only applies what's missing.

**Symptom if you forget:** the live site errors with something like
`relation "..." does not exist`. The fix is just to run the command above.

---

## Content: build it on the live site, not locally

Articles, pages, uploaded images, menus, and settings live in the **database**.
The clean habit is to create them **directly in the live admin**. Don't build
them locally and try to "sync the database" — see why below.

> **Published content taking ~5 minutes to show on the homepage or story list?**
> The live site is missing its cache-purge secret. This is a **one-time setup**
> fix, not something you do each time: set `PURGE_SECRET` to the **same** value on
> **both** the `api` and `web` services in Coolify, then redeploy both — see the
> [Coolify deployment runbook](./coolify-deployment.md). Single articles
> (`/article/…`) update instantly either way; only the cached list pages (home,
> stories, archive) lag without it. The admin's **Tools → Purge Cache** page will
> tell you if the secret is missing or mismatched.

---

## Why we don't copy the local database to live every time

It looks tempting ("just copy my whole local DB up") but it's a trap for routine
work:

- It would **overwrite** whatever is already on live, including content other
  people may have added.
- Your uploaded **images and files live in a separate store (MinIO)**, not in the
  database. A database copy doesn't bring them, so every image would break.
- Local settings often hold `localhost` URLs that are wrong for live.

Copying a database is a **rare, deliberate, one-time** job (for example, a first
launch, or moving a site between servers) — not part of the daily loop. If you
ever genuinely need it, treat it as its own careful task: back up live first,
move the database **and** the MinIO files together, then fix the URLs.

---

## Quick reference

```
# 1. build + test locally
pnpm dev                              # preview at http://localhost:3001

# 2. (assistant commits)

# 3. pre-flight
git status
git log origin/main..main --oneline   # what will be pushed

# 4. push (you)
git push

# 5. Coolify: auto-deploys, or click Deploy. Wait for green.

# 6. ONLY if the change touched the database shape — run once in
#    Coolify → api service → Terminal:
cd /repo/packages/db && node_modules/.bin/drizzle-kit migrate

# 7. content (articles/pages/images): create it in the LIVE admin.
```
