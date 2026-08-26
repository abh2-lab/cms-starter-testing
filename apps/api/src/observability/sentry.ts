import * as Sentry from '@sentry/node';
import { env } from '@cms/config';
import { resolveMonitoringConfig } from '../lib/monitoring-config.js';

// True after initSentry() runs with a non-empty DSN. Lets callers gate
// captureException without re-checking — and avoids the SDK's own
// "no DSN" warning spam on every event.
let enabled = false;
// True when the resolved config requested user-context attachment. Read by
// captureRequestException so attaching the user id is opt-in per the
// admin's Monitoring settings.
let attachUserContext = false;

/**
 * Initialise Sentry for the API process. Reads the monitoring_settings row
 * (single-tenant: NULL-tenant row) with SENTRY_* env fallback. Safe to call
 * multiple times — the SDK ignores re-init with the same options.
 *
 * Compatible with both Sentry SaaS and self-hosted Glitchtip; the destination
 * is chosen by the DSN supplied at deploy time.
 */
export async function initSentry(): Promise<void> {
  const config = await resolveMonitoringConfig({ tenantId: null });
  if (!config.dsn) return;

  if (!config.captureUnhandledErrors) {
    // Operator explicitly opted out of unhandled-error capture in the
    // dashboard. Skip init entirely so the SDK doesn't hook process events.
    return;
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment || env.NODE_ENV,
    ...(config.releaseTag ? { release: config.releaseTag } : {}),
    tracesSampleRate: config.tracesSampleRate,
    // Sentry's auto-discovered integrations include http + node; the defaults
    // are correct for a Fastify server behind a proxy.
  });
  enabled = true;
  attachUserContext = config.includeUserContext;
}

/**
 * Capture an exception with request-scoped tags so events group by reqId /
 * userId / tenantId in the Sentry UI. No-op when Sentry isn't initialised.
 * User context attachment is gated on the Monitoring settings toggle.
 */
export function captureRequestException(
  err: unknown,
  ctx: {
    reqId?: string;
    userId?: string | null;
    tenantId?: string | null;
    route?: string;
  },
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (ctx.reqId) scope.setTag('req_id', ctx.reqId);
    if (attachUserContext && ctx.userId) scope.setUser({ id: ctx.userId });
    if (ctx.tenantId) scope.setTag('tenant_id', ctx.tenantId);
    if (ctx.route) scope.setTag('route', ctx.route);
    Sentry.captureException(err);
  });
}

export function sentryEnabled(): boolean {
  return enabled;
}
