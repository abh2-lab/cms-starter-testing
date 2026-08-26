import { z } from 'zod';
import { DEV_VERSION, detectRepoVersion } from './version.js';

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
    API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
        { message: 'must be a postgres:// or postgresql:// connection string' },
      ),
    DIRECT_DATABASE_URL: z
      .string()
      .url()
      .refine(
        (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
        { message: 'must be a postgres:// or postgresql:// connection string' },
      )
      .optional(),
    REDIS_URL: z
      .string()
      .url()
      .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
        message: 'must be a redis:// or rediss:// URL',
      }),
    MEILI_HOST: z.string().url(),
    MEILI_MASTER_KEY: z.string().default(''),

    // ─── Object storage (S3-compatible: MinIO / Garage / AWS S3) ───────────
    S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1).default('cms-media'),
    S3_ACCESS_KEY_ID: z.string().min(1).default('minioadmin'),
    S3_SECRET_ACCESS_KEY: z.string().min(1).default('minioadmin'),
    // MinIO/Garage need path-style addressing; AWS uses virtual-hosted-style.
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // Optional public base URL (e.g. a CDN in front of the bucket). When empty,
    // the API hands out short-lived presigned GET URLs instead.
    S3_PUBLIC_URL: z.string().default(''),

    // Public HTTPS endpoint of the S3 API itself, used ONLY to sign
    // browser-facing URLs (presigned PUT for uploads, presigned GET for
    // display). The host baked into a presigned URL must be one the browser can
    // actually reach: in a containerized deploy S3_ENDPOINT is an internal name
    // (http://minio:9000) that the browser can't resolve and that triggers
    // mixed-content blocking on an HTTPS page. Set this to MinIO's public URL
    // (e.g. https://minio.example.com). Leave empty when S3_ENDPOINT is already
    // browser-reachable (real AWS S3, or local dev hitting localhost:9000).
    S3_PUBLIC_ENDPOINT: z.union([z.string().url(), z.literal('')]).default(''),

    // The tenant that the anonymous public routes (/api/public/*) serve. This
    // is a single-installation product: one publisher = one real tenant row, so
    // public reads resolve this slug → tenant id (admin routes get the tenant
    // from the session instead). Override per deployment.
    PUBLIC_TENANT_SLUG: z.string().min(1).default('test-tenant'),

    // Which theme this install runs. Drives the admin block/template palette
    // (see @cms/blocks CORE_BLOCK_KEYS) and, in the web build, which theme
    // layer is extended.
    //
    // The CMS ships two themes: 'default' (the generic core theme) and 'basic'
    // (the neutral starter). Both narrow the palette to the core blocks. A
    // publisher's CUSTOM theme — built by hand, like 'ping' in this repo — is
    // named explicitly here and exposes the full palette.
    //
    // Defaults to 'default', never to a custom theme: an exported starter has
    // no custom theme in it, so defaulting to one would leave a fresh install
    // pointing at a layer that does not exist. This repo's own .env sets
    // ACTIVE_THEME=ping.
    ACTIVE_THEME: z.string().min(1).default('default'),

    // (PUBLIC_WEB_URL used to live here. It's now sourced from siteSettings.siteUrl,
    // edited via the admin Site Settings page; see apps/api/src/lib/site-url.ts.)

    // Comma-separated browser origins allowed to call the API cross-origin.
    // In production the API otherwise refuses ALL cross-origin requests. The
    // admin UI never needs this (its nginx proxies /api same-origin), but the
    // public Nuxt site calls /api/public/* cross-origin from the browser, so
    // set this to the site's public origin(s), e.g.
    //   "https://news.example.com,https://www.news.example.com"
    // Leave empty in development — any origin is reflected automatically.
    // Parsed into a trimmed, non-empty string array.
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),

    // HMAC key for short-lived preview tokens issued by the admin "Preview"
    // button. Tokens are stateless (no DB row), so rotating this key
    // invalidates every outstanding preview link — that's the intended
    // emergency revocation mechanism. Required to be ≥32 chars in production
    // (see superRefine below); a throwaway default is allowed in dev so
    // first-time setup doesn't trip on this.
    PREVIEW_TOKEN_SECRET: z
      .string()
      .default('dev-preview-token-secret-change-me'),

    // Shared secret for the public site's nitro cache-purge endpoint
    // (POST {siteUrl}/api/_purge with x-purge-secret). The API calls it
    // fail-open after a theme-override publish/reset so SWR'd pages drop
    // their stale HTML immediately. Empty (the default) DISABLES the call —
    // installs running without Nuxt SWR lose nothing. Set the SAME value on
    // the api and web containers to enable it.
    PURGE_SECRET: z.string().default(''),

    // Optional internal base URL for reaching the web container server-to-server
    // (currently the cache-purge POST). When set, the API purges via this URL
    // instead of the public site URL — the fix for Coolify/Docker setups where a
    // container can't loop back to its own public https domain ("hairpin" NAT),
    // which otherwise makes the purge time out silently. Example: http://web:3001.
    // Empty (default) → fall back to the per-tenant public site URL.
    WEB_INTERNAL_URL: z.string().default(''),

    // ─── Email ─────────────────────────────────────────────────────────────
    // Transport selection — pick whichever provider the operator can reach:
    //   stub        — log to worker stdout (default; safe for unconfigured installs)
    //   smtp        — nodemailer + SMTP_* envs below
    //   resend      — Resend HTTPS API (RESEND_API_KEY)
    //   sendinblue  — Brevo / SendinBlue HTTPS API (SENDINBLUE_API_KEY)
    //   http        — generic Resend-shape POST to EMAIL_HTTP_* (Mailgun JSON,
    //                 Postmark, MailerSend, or any custom forwarder)
    // Per-provider required vars are enforced in superRefine below.
    EMAIL_PROVIDER: z
      .enum(['stub', 'smtp', 'resend', 'sendinblue', 'http'])
      .default('stub'),
    EMAIL_FROM: z.string().email().default('noreply@cms.local'),
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    // `true` for implicit TLS (465). `false` for STARTTLS upgrade or plaintext.
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Resend (https://resend.com/docs/api-reference/emails/send-email).
    RESEND_API_KEY: z.string().default(''),

    // Brevo / SendinBlue (https://developers.brevo.com/reference/sendtransacemail).
    // Keeps the "SENDINBLUE_" prefix because Brevo's docs still accept the name
    // and existing operator docs use it.
    SENDINBLUE_API_KEY: z.string().default(''),

    // Generic HTTP transport — accepts a Resend-shape JSON POST. Covers most
    // hosted email APIs and any custom forwarder. Bring your own auth header.
    EMAIL_HTTP_ENDPOINT: z.string().default(''),
    EMAIL_HTTP_AUTH_HEADER: z.string().default('Authorization'),
    EMAIL_HTTP_AUTH_VALUE: z.string().default(''),
    EMAIL_HTTP_METHOD: z.enum(['POST', 'PUT']).default('POST'),
    EMAIL_HTTP_CONTENT_TYPE: z.string().default('application/json'),

    // Master key from which the per-process AES-256-GCM key for webhook
    // signing-secret encryption is derived (scrypt with a fixed salt). Any
    // sufficiently random string works; rotating this key invalidates every
    // stored `webhooks.secret_encrypted` row — operators would need to use
    // the admin "Rotate secret" flow on each webhook to bring them back.
    // Must be ≥32 chars in production (superRefine below).
    WEBHOOK_SECRET_ENCRYPTION_KEY: z
      .string()
      .default('dev-webhook-secret-encryption-key-change-me'),

    // ─── Worker (apps/worker) ──────────────────────────────────────────────
    // The async worker exposes /health and /ready on this port for orchestrator
    // probes (Coolify, Kubernetes). No request routing happens here.
    WORKER_PORT: z.coerce.number().int().positive().max(65535).default(3100),
    // Sharp is multi-threaded internally via libvips; running many image
    // jobs in parallel saturates CPU on small VMs and starves other queues.
    // 2 is a safe default on 2–4 vCPU hosts. Tune up on bigger boxes.
    WORKER_IMAGE_CONCURRENCY: z.coerce.number().int().positive().default(2),
    // Webhook delivery is I/O-bound (outbound HTTP) — fan wide.
    WORKER_WEBHOOK_CONCURRENCY: z.coerce.number().int().positive().default(16),
    WORKER_SEARCH_INDEX_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .default(8),
    WORKER_SCHEDULE_PUBLISH_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .default(4),
    WORKER_EMAIL_CONCURRENCY: z.coerce.number().int().positive().default(4),

    // ─── Rate limiting (public API only) ───────────────────────────────────
    // Applied to /api/public/* via @fastify/rate-limit. Admin and v1 routes
    // are not rate-limited here — admin sits behind auth; v1 keys can be
    // revoked individually if abused. Counters live in Dragonfly (REDIS_URL)
    // so limits stay consistent when the API scales horizontally; if the
    // store ever errors, the plugin falls open by design (skipOnError).
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    // Plain-English window per @fastify/rate-limit — `"1 minute"`, `"30 seconds"`,
    // or a raw millisecond number as a string.
    RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),

    // ─── Error tracking (Sentry / Glitchtip) ───────────────────────────────
    // SDK is compatible with either backend; pick at deploy time by setting
    // the DSN. Leaving DSN empty disables capture entirely (the init becomes
    // a no-op) so dev environments don't ship test errors anywhere by default.
    SENTRY_DSN: z.string().default(''),
    // Defaults to NODE_ENV downstream; declared as a plain string so a deploy
    // can disambiguate e.g. "staging" from "production" both running NODE_ENV=production.
    SENTRY_ENVIRONMENT: z.string().default(''),
    // Performance tracing sample rate. 0 = error-only capture (zero perf
    // overhead). Bump per-deploy if traces become useful.
    SENTRY_TRACES_SAMPLE_RATE: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0),
    // Typically the git SHA — CI fills this in so events group by deploy.
    SENTRY_RELEASE: z.string().default(''),

    // ─── Version & update checks ───────────────────────────────────────────
    // See docs/phase-3-versioning-and-updates-plan.md.
    //
    // The version THIS build is. Set explicitly by the release workflow
    // (`--build-arg CMS_VERSION=<tag>`), which is authoritative once images
    // are published. When unset it falls back to the monorepo root
    // package.json, so a build-from-source deploy still reports its real
    // version instead of a permanent false "update available". Only if BOTH
    // are unavailable does it read '0.0.0' = an unversioned build, which the
    // update check treats as always-behind.
    // preprocess, not just .default(): Zod's default only fires on `undefined`,
    // but the value arrives EMPTY rather than absent in two real cases — an
    // empty `ARG CMS_VERSION=` in the Dockerfile, and a blank field in
    // Coolify's env UI. Without this, an empty string would fail .min(1) and
    // crash the container at boot instead of falling back.
    CMS_VERSION: z.preprocess(
      (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined),
      z.string().min(1).default(detectRepoVersion() ?? DEV_VERSION),
    ),
    // Where the release manifest lives. Must be reachable WITHOUT credentials:
    // the core repo is private, so the manifest gets its own small public repo
    // (it carries version numbers and notes only — nothing sensitive). Kept as
    // an env var, not a constant, so the manifest can move without shipping a
    // code release to every publisher.
    UPDATE_MANIFEST_URL: z
      .string()
      .default(
        'https://raw.githubusercontent.com/abh2-lab/cms-releases/main/releases.json',
      ),
    // Kill switch for the daily outbound check. The same setting also exists
    // per-install in the DB (update_status.check_enabled) so an operator can
    // turn it off from the admin without touching env; either one being off
    // disables the check. Env wins so a deploy can enforce it.
    UPDATE_CHECK_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // How long to wait on the manifest fetch. Short on purpose — a hung
    // release host must never keep a worker slot busy.
    UPDATE_CHECK_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && data.MEILI_MASTER_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MEILI_MASTER_KEY'],
        message: 'MEILI_MASTER_KEY is required when NODE_ENV=production',
      });
    }
    if (
      data.NODE_ENV === 'production' &&
      data.PREVIEW_TOKEN_SECRET.length < 32
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PREVIEW_TOKEN_SECRET'],
        message:
          'PREVIEW_TOKEN_SECRET must be at least 32 characters in production',
      });
    }
    if (data.EMAIL_PROVIDER === 'smtp' && data.SMTP_HOST.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_PROVIDER=smtp',
      });
    }
    if (
      data.EMAIL_PROVIDER === 'resend' &&
      data.RESEND_API_KEY.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
      });
    }
    if (
      data.EMAIL_PROVIDER === 'sendinblue' &&
      data.SENDINBLUE_API_KEY.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SENDINBLUE_API_KEY'],
        message:
          'SENDINBLUE_API_KEY is required when EMAIL_PROVIDER=sendinblue',
      });
    }
    if (data.EMAIL_PROVIDER === 'http') {
      if (data.EMAIL_HTTP_ENDPOINT.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_HTTP_ENDPOINT'],
          message:
            'EMAIL_HTTP_ENDPOINT is required when EMAIL_PROVIDER=http',
        });
      }
      if (data.EMAIL_HTTP_AUTH_VALUE.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_HTTP_AUTH_VALUE'],
          message:
            'EMAIL_HTTP_AUTH_VALUE is required when EMAIL_PROVIDER=http',
        });
      }
    }
    if (
      data.NODE_ENV === 'production' &&
      data.WEBHOOK_SECRET_ENCRYPTION_KEY.length < 32
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_SECRET_ENCRYPTION_KEY'],
        message:
          'WEBHOOK_SECRET_ENCRYPTION_KEY must be at least 32 characters in production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');
}

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Surface only field names + messages, never values — env may contain secrets.
  throw new Error(
    `Invalid environment configuration:\n${formatIssues(parsed.error)}\n\nCheck your .env file or process environment.`,
  );
}

export const env: Env = parsed.data;
