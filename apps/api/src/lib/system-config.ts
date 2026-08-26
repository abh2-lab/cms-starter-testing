import { eq, isNull } from 'drizzle-orm';
import { db, isUndefinedTableError, schema } from '@cms/db';
import { env } from '@cms/config';

// Rate-limit window stored as a structured pair to drive the dashboard form.
// At consumption time it serialises back to the plain-English string
// @fastify/rate-limit accepts (e.g. "60 seconds", "1 minute").
export type RateLimitUnit = 'second' | 'minute';
export interface RateLimitWindow {
  value: number;
  unit: RateLimitUnit;
}

export interface ResolvedSystemConfig {
  rateLimitMax: number;
  rateLimitWindow: RateLimitWindow;
  workerImageConcurrency: number;
  workerWebhookConcurrency: number;
  workerSearchIndexConcurrency: number;
  workerSchedulePublishConcurrency: number;
  workerEmailConcurrency: number;
}

/**
 * Parse the env-fallback RATE_LIMIT_WINDOW string into a {value, unit}. The
 * env-string format is whatever @fastify/rate-limit accepts:
 *   - "1 minute" / "2 minutes" → {value: N, unit: 'minute'}
 *   - "30 seconds" / "1 second" → {value: N, unit: 'second'}
 *   - "60000" (raw ms) → normalised to seconds or minutes if evenly divisible
 *   - anything else → fallback default {value: 1, unit: 'minute'}
 *
 * Critical to migrate old env-driven installs: `RATE_LIMIT_WINDOW=60000`
 * (= 60 seconds) must not become `{value: 60000, unit: 'second'}` — that
 * would be 60000 seconds = ~16 hours, which is nonsense.
 */
export function parseRateLimitWindow(input: string): RateLimitWindow {
  const trimmed = input.trim();

  // Pure digits → milliseconds. Normalise to a sensible unit.
  if (/^\d+$/.test(trimmed)) {
    const ms = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(ms) || ms <= 0) {
      return { value: 1, unit: 'minute' };
    }
    if (ms % 60_000 === 0) {
      return { value: ms / 60_000, unit: 'minute' };
    }
    if (ms % 1_000 === 0) {
      return { value: ms / 1_000, unit: 'second' };
    }
    // Sub-second precision is below what fastify-rate-limit expresses with
    // unit strings; round to the nearest second.
    return { value: Math.max(1, Math.round(ms / 1_000)), unit: 'second' };
  }

  const match = /^(\d+)\s*(second|seconds|minute|minutes)$/i.exec(trimmed);
  if (!match) {
    return { value: 1, unit: 'minute' };
  }
  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase().startsWith('s') ? 'second' : 'minute';
  if (!Number.isFinite(value) || value <= 0) {
    return { value: 1, unit: 'minute' };
  }
  return { value, unit };
}

/** Convert back to the plain-English string @fastify/rate-limit expects. */
export function serializeRateLimitWindow(window: RateLimitWindow): string {
  const unit = window.value === 1 ? window.unit : `${window.unit}s`;
  return `${window.value} ${unit}`;
}

function envFallbackConfig(): ResolvedSystemConfig {
  return {
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindow: parseRateLimitWindow(env.RATE_LIMIT_WINDOW),
    workerImageConcurrency: env.WORKER_IMAGE_CONCURRENCY,
    workerWebhookConcurrency: env.WORKER_WEBHOOK_CONCURRENCY,
    workerSearchIndexConcurrency: env.WORKER_SEARCH_INDEX_CONCURRENCY,
    workerSchedulePublishConcurrency: env.WORKER_SCHEDULE_PUBLISH_CONCURRENCY,
    workerEmailConcurrency: env.WORKER_EMAIL_CONCURRENCY,
  };
}

export async function resolveSystemConfig(args: {
  tenantId: string | null;
}): Promise<ResolvedSystemConfig> {
  let row: typeof schema.systemSettings.$inferSelect | undefined;
  try {
    [row] = await db
      .select()
      .from(schema.systemSettings)
      .where(
        args.tenantId === null
          ? isNull(schema.systemSettings.tenantId)
          : eq(schema.systemSettings.tenantId, args.tenantId),
      )
      .limit(1);
  } catch (err) {
    // Pre-migrate state: table doesn't exist yet. Fall back to RATE_LIMIT_*
    // and WORKER_*_CONCURRENCY env vars.
    if (isUndefinedTableError(err, 'system_settings')) {
      return envFallbackConfig();
    }
    throw err;
  }

  if (!row) return envFallbackConfig();

  // Defensive: clamp the stored unit to 'second' | 'minute' even if a stray
  // value snuck into the column (the Zod schema in the admin route enforces
  // the same set).
  const unit: RateLimitUnit =
    row.rateLimitWindowUnit === 'second' ? 'second' : 'minute';

  return {
    rateLimitMax: row.rateLimitMax,
    rateLimitWindow: { value: row.rateLimitWindowValue, unit },
    workerImageConcurrency: row.workerImageConcurrency,
    workerWebhookConcurrency: row.workerWebhookConcurrency,
    workerSearchIndexConcurrency: row.workerSearchIndexConcurrency,
    workerSchedulePublishConcurrency: row.workerSchedulePublishConcurrency,
    workerEmailConcurrency: row.workerEmailConcurrency,
  };
}
