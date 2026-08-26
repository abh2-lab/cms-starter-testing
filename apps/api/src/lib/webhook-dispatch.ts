import { dispatchEvent as sharedDispatchEvent } from '@cms/queue';
import type { FastifyBaseLogger } from 'fastify';

import { producers } from './queue.js';

/**
 * Thin wrapper around @cms/queue's `dispatchEvent` that pre-binds the API
 * process's producer surface. Routes call this with their request logger
 * and the event details — fire-and-forget is the intended use.
 *
 * Shared implementation lives in @cms/queue/src/side-effects.ts so the
 * worker (scheduled-publish processor) can call the same logic when it
 * auto-publishes a scheduled row.
 */
export async function dispatchEvent(
  log: FastifyBaseLogger,
  eventName: string,
  payload: Record<string, unknown>,
  tenantId: string | null,
  reqId?: string,
): Promise<void> {
  return sharedDispatchEvent({
    producers,
    log,
    eventName,
    payload,
    tenantId,
    ...(reqId !== undefined ? { reqId } : {}),
  });
}
