import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from '@cms/config';
import { runReadinessChecks } from './lib/health-checks.js';
import { getRateLimitRedis } from './lib/rate-limit-redis.js';
import { captureRequestException } from './observability/sentry.js';
import { adminAuthRoutes, SESSION_COOKIE_NAME } from './routes/admin/auth.js';
import { adminSetupRoutes } from './routes/admin/setup.js';
import { adminMeRoutes } from './routes/admin/me.js';
import { adminContentRoutes } from './routes/admin/content.js';
import { adminPagesRoutes } from './routes/admin/pages.js';
import { adminBlocksRoutes } from './routes/admin/blocks.js';
import { adminThemeRoutes } from './routes/admin/theme.js';
import { adminUpdatesRoutes } from './routes/admin/updates.js';
import { adminPageTemplatesRoutes } from './routes/admin/page-templates.js';
import { adminPostTemplatesRoutes } from './routes/admin/post-templates.js';
import { adminContentTypesRoutes } from './routes/admin/content-types.js';
import { adminTaxonomiesRoutes } from './routes/admin/taxonomies.js';
import { adminMediaRoutes } from './routes/admin/media.js';
import { adminRedirectsRoutes } from './routes/admin/redirects.js';
import { adminMenusRoutes } from './routes/admin/menus.js';
import { adminSiteSettingsRoutes } from './routes/admin/site-settings.js';
import { adminEmailSettingsRoutes } from './routes/admin/email-settings.js';
import { adminStorageSettingsRoutes } from './routes/admin/storage-settings.js';
import { adminMonitoringSettingsRoutes } from './routes/admin/monitoring-settings.js';
import { adminAiSettingsRoutes } from './routes/admin/ai-settings.js';
import { adminAiChatRoutes } from './routes/admin/ai-chat.js';
import { adminSystemSettingsRoutes } from './routes/admin/system-settings.js';
import {
  resolveSystemConfig,
  serializeRateLimitWindow,
} from './lib/system-config.js';
import { adminApiKeysRoutes } from './routes/admin/api-keys.js';
import { adminWebhooksRoutes } from './routes/admin/webhooks.js';
import { adminUsersRoutes } from './routes/admin/users.js';
import { adminDashboardRoutes } from './routes/admin/dashboard.js';
import { adminQueuesRoutes } from './routes/admin/queues.js';
import { adminDocsRoutes } from './routes/admin/docs.js';
import { adminCacheRoutes } from './routes/admin/cache.js';
import { v1MeRoutes } from './routes/v1/me.js';
import { publicRedirectsRoutes } from './routes/public/redirects.js';
import { publicSiteSettingsRoutes } from './routes/public/site-settings.js';
import { publicMenusRoutes } from './routes/public/menus.js';
import { publicTaxonomyTermsRoutes } from './routes/public/taxonomy-terms.js';
import { publicResolveRoutes } from './routes/public/resolve.js';
import { publicContentRoutes } from './routes/public/content.js';
import { publicPagesRoutes } from './routes/public/pages.js';
import { publicBlocksRoutes } from './routes/public/blocks.js';
import { publicArchiveRoutes } from './routes/public/archive.js';
import { publicViewsRoutes } from './routes/public/views.js';
import { publicPartsRoutes } from './routes/public/parts.js';
import { publicSearchRoutes } from './routes/public/search.js';
import { publicSubmissionsRoutes } from './routes/public/submissions.js';

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Redact tokens/cookies/passwords from accidental log lines (e.g. when
      // a handler serialises the whole request or a settings blob). Mirrors
      // the worker's pino config so an operator's grep rules transfer.
      redact: {
        paths: [
          'password',
          'token',
          '*.password',
          '*.token',
          'headers.authorization',
          'headers.cookie',
        ],
        censor: '[redacted]',
      },
      // Pretty-print in dev; structured JSON in test/prod for log aggregators.
      ...(env.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
      }),
    },
    // Deterministic UUIDv4 request ids — easier to grep across API + worker
    // logs than the default nanoid counter, and survives a forwarded reqId
    // from an upstream proxy when we accept one later.
    genReqId: () => randomUUID(),
    // The API will eventually sit behind a reverse proxy (Caddy / nginx).
    trustProxy: true,
    // Treat /foo and /foo/ as the same route. Needed for Bull Board, whose
    // Fastify adapter mounts its UI at `<prefix>/` (with trailing slash) —
    // without this, `/api/admin/queues` returns 404 while `/api/admin/queues/`
    // 401s on auth. Universally enabled because no existing route depends on
    // the distinction; saves operators a UX paper cut.
    routerOptions: { ignoreTrailingSlash: true },
  });

  // Forward uncaught route errors to Sentry, then defer to Fastify's default
  // formatter so the JSON shape clients receive is unchanged. Layered on top
  // of (not in place of) the existing request.log.error inside handlers —
  // both sinks are useful when alerting + grepping.
  fastify.setErrorHandler((err, request, reply) => {
    const session = request.adminSession;
    captureRequestException(err, {
      reqId: request.id,
      userId: session?.user.id ?? null,
      tenantId: session?.user.tenantId ?? null,
      route: request.routeOptions.url ?? request.url,
    });
    reply.send(err);
  });

  await fastify.register(cookie);
  // CSP is off here because the API doesn't serve HTML. The admin/web apps
  // each set their own CSP.
  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, {
    credentials: true,
    // If CORS_ALLOWED_ORIGINS is set (any environment), use it as the explicit
    // allow-list — @fastify/cors reflects a matching Origin back, so credentials
    // work. Otherwise fall back to the safe defaults: dev reflects any Origin;
    // prod is locked off (no cross-origin) until an allow-list is provided.
    // The admin UI doesn't need an entry here (its nginx proxies /api
    // same-origin); the public Nuxt site does, since it calls the API
    // cross-origin from the browser.
    origin:
      env.CORS_ALLOWED_ORIGINS.length > 0
        ? env.CORS_ALLOWED_ORIGINS
        : env.NODE_ENV === 'production'
          ? false
          : true,
  });
  await fastify.register(sensible);

  // Swagger/OpenAPI docs are exposed only outside production to avoid publicly
  // advertising the full API surface. When enabled, the spec is served at
  // /docs/json and the interactive UI at /docs. Must be registered before the
  // routes it documents.
  if (env.NODE_ENV !== 'production') {
    await fastify.register(swagger, {
      // Keep the original $id (e.g. "MenuItemNode") as the component name in
      // the OpenAPI spec — without this the default resolver buckets shared
      // schemas as def-0, def-1… which reads as noise in the docs UI.
      refResolver: {
        buildLocalReference(json, _baseUri, _fragment, i) {
          const id = (json as { $id?: string }).$id;
          return id ?? `def-${i}`;
        },
      },
      openapi: {
        info: {
          title: '@cms/api',
          description: [
            'Self-hosted headless CMS API. Three surfaces, three auth modes:',
            '',
            '- **Public** — `/api/public/*` is anonymous and read-only. Responses are cached in Dragonfly for 5 minutes and carry `Cache-Control: public, max-age=300, s-maxage=300` so a CDN can layer on top.',
            '- **Programmatic** — `/api/v1/*` requires an Authorization: Bearer header carrying an API key.',
            '- **Admin** — `/api/admin/*` requires a session cookie.',
          ].join('\n'),
          version: '0.0.0',
        },
        tags: [
          {
            name: 'Content',
            description:
              'Fetch individual published content items by slug',
          },
          {
            name: 'Archive',
            description:
              'Paginated lists of published content, filterable by type, category and tag',
          },
          {
            name: 'Taxonomy',
            description:
              'Categories and tags for building navigation or filter UIs',
          },
          {
            name: 'Menus',
            description: 'Navigation menus and their nested items',
          },
          {
            name: 'Site',
            description: 'Global site settings and configuration',
          },
          {
            name: 'Redirects',
            description:
              'Active 301/302 redirect rules for SSR middleware to consume',
          },
          {
            name: 'Search',
            description:
              'Full-text search across published content, backed by Meilisearch',
          },
          {
            name: 'Identity',
            description: 'API-key holder identity (programmatic access)',
          },
        ],
        components: {
          securitySchemes: {
            cookieAuth: {
              type: 'apiKey',
              in: 'cookie',
              name: SESSION_COOKIE_NAME,
            },
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'API key',
            },
          },
        },
      },
    });
    await fastify.register(swaggerUi, { routePrefix: '/docs' });
  }

  // Shared response shapes. Registered via addSchema (not just listed in
  // openapi.components.schemas) so Fastify's response serializer can resolve
  // $ref against them at request time. fastify-swagger picks these up and
  // emits them into components.schemas in the generated spec automatically.
  fastify.addSchema({
    $id: 'MenuItemNode',
    type: 'object',
    description: 'A single menu item; children are the same shape, recursively',
    properties: {
      id: { type: 'string', format: 'uuid' },
      label: { type: 'string' },
      url: {
        type: 'string',
        nullable: true,
        description:
          'Direct URL for the item, or null if it links to content (see contentSlug/contentType)',
      },
      contentSlug: {
        type: 'string',
        nullable: true,
        description:
          'Slug of the linked content row, if any. Combine with contentType to build the URL.',
      },
      contentType: {
        type: 'string',
        nullable: true,
        description: 'content_type slug of the linked content row',
      },
      openInNewTab: {
        type: 'boolean',
        description: 'Whether the link should open in a new browser tab',
      },
      sortOrder: { type: 'integer' },
      children: {
        type: 'array',
        items: { $ref: 'MenuItemNode#' },
      },
    },
    required: ['id', 'label', 'sortOrder', 'children'],
  });

  fastify.addSchema({
    $id: 'TaxonomyTerm',
    type: 'object',
    description: 'A single taxonomy term attached to a content row',
    properties: {
      termSlug: { type: 'string' },
      termName: { type: 'string' },
      taxonomySlug: {
        type: 'string',
        description: 'Slug of the parent taxonomy (e.g. "category", "tag")',
      },
    },
    required: ['termSlug', 'termName', 'taxonomySlug'],
  });

  // Liveness — "the process is up", zero dependencies. Coolify / k8s use
  // this to decide whether to restart the container. A degraded readiness
  // check should NEVER cause a restart, so this stays separate.
  fastify.get('/health/live', async () => ({
    status: 'ok',
    service: '@cms/api',
    env: env.NODE_ENV,
  }));

  // Readiness — probes DB, Dragonfly, Meili, and S3 in parallel with a 2s
  // per-probe timeout, then caches the result for 5s in-process. Returns 503
  // (not 500) when any dep is down so an orchestrator can stop routing
  // traffic to this replica without rolling it.
  fastify.get('/health/ready', async (_request, reply) => {
    const result = await runReadinessChecks();
    return reply
      .code(result.ok ? 200 : 503)
      .send({
        status: result.ok ? 'ready' : 'not-ready',
        service: '@cms/api',
        env: env.NODE_ENV,
        checks: result.checks,
      });
  });

  // Back-compat alias for anything still hitting /health (the original
  // single-endpoint shape). New consumers should pick /health/live or
  // /health/ready explicitly.
  fastify.get('/health', async (_request, reply) => {
    const result = await runReadinessChecks();
    return reply
      .code(result.ok ? 200 : 503)
      .send({
        status: result.ok ? 'ok' : 'degraded',
        service: '@cms/api',
        env: env.NODE_ENV,
        checks: result.checks,
      });
  });

  await fastify.register(adminAuthRoutes, { prefix: '/api/admin/auth' });
  // First Boot Experience: status check + initial super_admin registration.
  // Anonymous endpoints — gated by the "no super_admin exists" check inside.
  await fastify.register(adminSetupRoutes, { prefix: '/api/admin/setup' });
  // "Me" endpoints — anything the authenticated admin does to their own
  // account (tour completion, future profile updates).
  await fastify.register(adminMeRoutes, { prefix: '/api/admin/me' });
  await fastify.register(adminContentTypesRoutes, {
    prefix: '/api/admin/content-types',
  });
  await fastify.register(adminTaxonomiesRoutes, {
    prefix: '/api/admin/taxonomies',
  });
  await fastify.register(adminContentRoutes, { prefix: '/api/admin/content' });
  await fastify.register(adminPagesRoutes, { prefix: '/api/admin/pages' });
  await fastify.register(adminBlocksRoutes, { prefix: '/api/admin/blocks' });
  await fastify.register(adminThemeRoutes, { prefix: '/api/admin/theme' });
  await fastify.register(adminUpdatesRoutes, { prefix: '/api/admin/updates' });
  await fastify.register(adminPageTemplatesRoutes, {
    prefix: '/api/admin/page-templates',
  });
  await fastify.register(adminPostTemplatesRoutes, {
    prefix: '/api/admin/post-templates',
  });
  await fastify.register(adminMediaRoutes, { prefix: '/api/admin/media' });
  await fastify.register(adminRedirectsRoutes, {
    prefix: '/api/admin/redirects',
  });
  await fastify.register(adminMenusRoutes, { prefix: '/api/admin/menus' });
  await fastify.register(adminSiteSettingsRoutes, {
    prefix: '/api/admin/site-settings',
  });
  await fastify.register(adminEmailSettingsRoutes, {
    prefix: '/api/admin/settings/email',
  });
  await fastify.register(adminStorageSettingsRoutes, {
    prefix: '/api/admin/settings/storage',
  });
  await fastify.register(adminMonitoringSettingsRoutes, {
    prefix: '/api/admin/settings/monitoring',
  });
  await fastify.register(adminAiSettingsRoutes, {
    prefix: '/api/admin/settings/ai',
  });
  await fastify.register(adminAiChatRoutes, { prefix: '/api/admin/ai' });
  await fastify.register(adminSystemSettingsRoutes, {
    prefix: '/api/admin/settings/system',
  });
  await fastify.register(adminApiKeysRoutes, { prefix: '/api/admin/api-keys' });
  await fastify.register(adminWebhooksRoutes, {
    prefix: '/api/admin/webhooks',
  });
  await fastify.register(adminUsersRoutes, { prefix: '/api/admin/users' });
  await fastify.register(adminDashboardRoutes, {
    prefix: '/api/admin/dashboard',
  });
  // Bull Board — super_admin only; mounted under /api/admin/queues. The
  // mounted prefix MUST match the basePath set inside adminQueuesRoutes.
  await fastify.register(adminQueuesRoutes, { prefix: '/api/admin/queues' });
  // API Docs Generator — super_admin only. Two endpoints: /sections (selector
  // data) and /generate (produces a Markdown file from the user's selection).
  await fastify.register(adminDocsRoutes, { prefix: '/api/admin/docs' });
  // Tools → Purge Cache — super_admin only. POST /purge clears cached copies
  // on demand (data cache + web HTML). Deletes no data; fail-open.
  await fastify.register(adminCacheRoutes, { prefix: '/api/admin/cache' });

  // Programmatic API — API-key authenticated (Authorization: Bearer <key>).
  await fastify.register(v1MeRoutes, { prefix: '/api/v1' });

  // Rate-limit config sourced from system_settings (with RATE_LIMIT_* env
  // fallback). Read once at boot — operator restarts the API to pick up
  // changes; the dashboard surfaces this in the save toast.
  const systemCfg = await resolveSystemConfig({ tenantId: null });
  const rateLimitWindow = serializeRateLimitWindow(systemCfg.rateLimitWindow);

  // Anonymous public reads (no auth) — scoped under one register() so the
  // rate-limit plugin only sees /api/public/* and the admin / v1 surfaces
  // stay unthrottled. The plugin opens its Redis client lazily on first use;
  // if Dragonfly is unreachable, `skipOnError: true` makes the limiter fail
  // open so a cache outage can't take the public site down.
  await fastify.register(
    async (publicScope) => {
      await publicScope.register(rateLimit, {
        max: systemCfg.rateLimitMax,
        timeWindow: rateLimitWindow,
        redis: getRateLimitRedis(),
        skipOnError: true,
        // Honour X-Forwarded-For when behind the proxy (trustProxy is on at
        // the Fastify level). Without this every request looks like it came
        // from the reverse-proxy IP and the limit becomes useless.
        keyGenerator: (req) => req.ip,
      });
      await publicScope.register(publicRedirectsRoutes, { prefix: '/redirects' });
      await publicScope.register(publicSiteSettingsRoutes, {
        prefix: '/site-settings',
      });
      await publicScope.register(publicMenusRoutes, { prefix: '/menus' });
      await publicScope.register(publicTaxonomyTermsRoutes, {
        prefix: '/taxonomy-terms',
      });
      await publicScope.register(publicResolveRoutes, { prefix: '/resolve' });
      await publicScope.register(publicContentRoutes, { prefix: '/content' });
      await publicScope.register(publicPagesRoutes, { prefix: '/pages' });
      await publicScope.register(publicBlocksRoutes, { prefix: '/blocks' });
      await publicScope.register(publicArchiveRoutes, { prefix: '/archive' });
      await publicScope.register(publicViewsRoutes, { prefix: '/views' });
      await publicScope.register(publicPartsRoutes, { prefix: '/parts' });
      await publicScope.register(publicSearchRoutes, { prefix: '/search' });
      await publicScope.register(publicSubmissionsRoutes, {
        prefix: '/submissions',
      });
    },
    { prefix: '/api/public' },
  );

  return fastify;
}
