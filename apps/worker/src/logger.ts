import { pino } from 'pino';
import { env } from '@cms/config';

/**
 * Pino logger with API-compatible field shape so log aggregators can stitch
 * job traces to the originating request — every job that came from the API
 * should carry the API request id via job.data when we later add tracing.
 *
 * NODE_ENV=development pretty-prints via pino-pretty if installed (Fastify
 * ships it transitively for the API; the worker doesn't list it directly,
 * so dev output falls back to plain JSON when pino-pretty is absent — that
 * is fine for a background worker).
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: 'worker' },
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
});

export type Logger = typeof logger;

/**
 * Pull the API's request id out of a job payload, if present, in a shape
 * suitable for spreading into a child logger binding object:
 *
 *   const childLog = log.child({ queue, jobId: job.id, ...jobMeta(job.data) });
 *
 * Producers in the API stash `reqId` alongside the typed payload so a single
 * grep links the originating Fastify request to every downstream worker log
 * line. Repeatable sweeps and back-fill scripts dispatch without one — the
 * helper returns `{}` in that case so child() bindings stay clean.
 */
export function jobMeta(data: unknown): { reqId?: string } {
  if (
    data &&
    typeof data === 'object' &&
    'reqId' in data &&
    typeof data.reqId === 'string'
  ) {
    return { reqId: data.reqId };
  }
  return {};
}
