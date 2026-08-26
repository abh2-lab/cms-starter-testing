import { eq, isNull } from 'drizzle-orm';
import { db, isUndefinedTableError, schema } from '@cms/db';
import { decryptWebhookSecret } from '@cms/queue';
import { env } from '@cms/config';

// Resolved monitoring config. Sentry init reads this once at boot; no
// per-request invalidation. Changes require an API restart to take effect —
// the dashboard surfaces this after save.
export interface ResolvedMonitoringConfig {
  dsn: string;
  environment: string;
  releaseTag: string;
  /** 0.0-1.0 (DB stores 0-100; resolver divides). */
  tracesSampleRate: number;
  captureUnhandledErrors: boolean;
  includeUserContext: boolean;
}

function decryptOrEmpty(buf: Buffer | null): string {
  if (!buf || buf.length === 0) return '';
  try {
    return decryptWebhookSecret(buf);
  } catch {
    return '';
  }
}

function envFallbackConfig(): ResolvedMonitoringConfig {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    releaseTag: env.SENTRY_RELEASE,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    captureUnhandledErrors: true,
    includeUserContext: false,
  };
}

export async function resolveMonitoringConfig(args: {
  tenantId: string | null;
}): Promise<ResolvedMonitoringConfig> {
  let row: typeof schema.monitoringSettings.$inferSelect | undefined;
  try {
    [row] = await db
      .select()
      .from(schema.monitoringSettings)
      .where(
        args.tenantId === null
          ? isNull(schema.monitoringSettings.tenantId)
          : eq(schema.monitoringSettings.tenantId, args.tenantId),
      )
      .limit(1);
  } catch (err) {
    // Pre-migrate state: table doesn't exist yet. Fall back to SENTRY_* env.
    if (isUndefinedTableError(err, 'monitoring_settings')) {
      return envFallbackConfig();
    }
    throw err;
  }

  if (!row) return envFallbackConfig();

  const dsn = decryptOrEmpty(row.sentryDsnEncrypted) || env.SENTRY_DSN;
  return {
    dsn,
    environment:
      row.environment && row.environment.length > 0
        ? row.environment
        : env.SENTRY_ENVIRONMENT,
    releaseTag:
      row.releaseTag && row.releaseTag.length > 0
        ? row.releaseTag
        : env.SENTRY_RELEASE,
    tracesSampleRate: row.tracesSampleRate / 100,
    captureUnhandledErrors: row.captureUnhandledErrors,
    includeUserContext: row.includeUserContext,
  };
}
