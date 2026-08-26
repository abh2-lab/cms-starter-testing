# Security audit — Phase 7

Walkthrough findings for the seven security items in the Phase 7 plan,
captured in the same order the plan listed them. Items marked **DONE** are
fixed in this phase. Items marked **TRACK** are documented gaps with an
owner / next step.

## 1. CSP / HSTS — partial

**API:** helmet is registered with `contentSecurityPolicy: false`
([apps/api/src/server.ts:67-69](../../apps/api/src/server.ts)). The API
serves no HTML, so CSP at this layer is meaningless. Helmet's other
headers (`X-Content-Type-Options`, `X-DNS-Prefetch-Control`,
`Strict-Transport-Security`, …) are emitted with defaults — sufficient.

**Public web (Nuxt):** HSTS + a baseline of safe headers added this phase
([apps/web/nuxt.config.ts](../../apps/web/nuxt.config.ts), production-only
`routeRules`). Headers added:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: SAMEORIGIN`

**CSP on the public web: TRACK.** A tight CSP would need an allowlist for
the live `fonts.googleapis.com` + `fonts.gstatic.com` link/preconnects and
the S3 / Garage host the media serves from. Getting it wrong silently breaks
hydration, so it's deferred. Owner: next operations-focused phase.

**Admin (Vue/Vite):** the bare `index.html` does not emit CSP. The admin
is typically deployed as static files behind Caddy / Nginx in front of the
API; the right place for its CSP + HSTS is the reverse-proxy config, not
the Vite build. **TRACK** — operators should add to their proxy:

```
Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
X-Content-Type-Options nosniff
X-Frame-Options SAMEORIGIN
Referrer-Policy strict-origin-when-cross-origin
```

## 2. CORS — DONE (documented)

`origin: false` in production, `origin: true` in dev
([apps/api/src/server.ts](../../apps/api/src/server.ts)).

`false` denies all browser callers, which is correct for the single-install
model: the admin SPA and the public Nuxt site call the API same-origin
through the reverse proxy. Recorded here so a well-meaning future change
doesn't "fix" it to a permissive origin.

If a multi-origin deployment is ever needed (e.g. mobile app calling the
API directly from a different host), introduce a discrete `CORS_ORIGINS`
env list — never re-enable `origin: true`.

## 3. Cookie signing — DONE (documented)

The session cookie at
[apps/api/src/routes/admin/auth.ts:76-82](../../apps/api/src/routes/admin/auth.ts)
is NOT signed (`signed: false` by default in `@fastify/cookie`). This is
**intentional and correct**:

The session token is an opaque 256-bit random string stored alongside its
SHA-256 hash in `admin_sessions`. A forged cookie value either:
- doesn't hash to any stored row (lookup fails → 401), or
- happens to hash to a row by chance (probability ≈ 1 / 2^256 — implausible).

The cookie value IS the integrity primitive. HMAC signing on top would add
no security and would couple the entire session table to a single secret;
losing or rotating that secret would log everyone out. The opaque-token
design is what makes per-session revocability work and was the ratified
auth decision.

## 4. Media upload validation — DONE

Pre-W8, the presign and register endpoints trusted client-submitted
`contentType` / `mimeType` with no allowlist and no enforced size cap. Fixed
in this phase via [apps/api/src/lib/media-allowlist.ts](../../apps/api/src/lib/media-allowlist.ts):

- Allowlist: jpeg, png, webp, gif, avif, pdf, mp4 (with per-type byte caps,
  jpeg/png/webp/avif at 25 MB, gif at 10 MB, pdf at 50 MB, mp4 at 200 MB).
- SVG is **excluded**. SVG served as `image/svg+xml` can embed inline
  `<script>` that fires on the public site → stored XSS. Re-enable only with
  a server-side sanitiser in the pipeline and a deliberate opt-in env flag.
- Enforced at both presign (HTTP 415 / 413 before a URL is issued) and
  register (defence in depth — a malicious client could PUT bytes to a
  presigned URL and then register with a different mimeType).

The MIME values are still client-asserted; the API does not sniff. If
content-sniffing becomes important (e.g. files renamed to `.jpg` that are
actually PDFs), add a server-side magic-byte check in the image-process
worker. For now the allowlist + Sharp's decode failure in the worker
provides reasonable protection for the image path.

## 5. Dependency CVE scanning — DONE

Added two CI steps in
[.github/workflows/ci.yml](../../.github/workflows/ci.yml):

1. **Gating:** `pnpm audit --prod --audit-level=high` — fails the build
   on any HIGH or CRITICAL CVE in production dependencies.
2. **Informational:** `pnpm audit --prod` — always runs, never fails;
   surfaces moderate / low advisories without blocking merges.

Dev dependencies are not gated (eslint plugins occasionally trip moderate
advisories that don't reach prod). Operators can run `pnpm audit` locally
to see the same output.

## 6. Secret-handling redaction — DONE

Both the API ([apps/api/src/server.ts](../../apps/api/src/server.ts) Fastify
logger config) and the worker
([apps/worker/src/logger.ts](../../apps/worker/src/logger.ts)) carry the
same Pino `redact` paths:

```
password, token, *.password, *.token, headers.authorization, headers.cookie
```

This covers the common foot-guns:
- `request.log.info({ user })` where `user` has a `password` field
- accidentally logging the whole `request.headers` object
- BullMQ job data containing a `token` field

Stored secrets that do NOT pass through structured logging (e.g.
`WEBHOOK_SECRET_ENCRYPTION_KEY`, `PREVIEW_TOKEN_SECRET` read from env at
boot) never appear in logs by construction. The env validator in
@cms/config errors with field names only on bad input — never the values.

## 7. Public draft-leak — verified by inspection; integration test TRACK

The public content route at
[apps/api/src/routes/public/content.ts:196-221](../../apps/api/src/routes/public/content.ts)
filters every non-preview read with:

```
content.tenant_id = tenant
AND content_types.slug = type
AND content.slug = slug
AND content.status = 'published'
AND (publish_at IS NULL OR publish_at <= now())
AND (unpublish_at IS NULL OR unpublish_at > now())
```

Preview-mode bypasses the published-status + window filter but only matches
the exact contentId the token was issued for
([apps/api/src/routes/public/content.ts:264](../../apps/api/src/routes/public/content.ts)),
so a stolen token can't be reused on sibling slugs in the same tenant.

The public archive
([apps/api/src/routes/public/archive.ts](../../apps/api/src/routes/public/archive.ts))
and search ([apps/api/src/routes/public/search.ts](../../apps/api/src/routes/public/search.ts))
apply the same filter; Meili's `filter` clause includes `status=published`
plus the tenant filter on every public query.

**TRACK:** no integration test currently asserts these filters at the HTTP
level. The existing test suite is pure unit tests (no live DB). Phase 8
should add an integration-test harness (test Postgres container + Fastify
inject) and start with this regression: seed an unpublished content row,
hit `GET /api/public/content/:type/:slug` with its slug, assert 404.

## Open follow-ups

| Item | Owner | When |
|---|---|---|
| CSP on the public web (full allowlist for fonts + S3) | ops | Phase 8 |
| CSP/HSTS on the admin via reverse proxy | operator (per-deploy) | Per-deploy |
| Content-sniffing for non-image uploads (magic-byte check) | image-process worker enhancement | Phase 8 |
| Integration-test harness + public draft-leak regression | test infra | Phase 8 |
