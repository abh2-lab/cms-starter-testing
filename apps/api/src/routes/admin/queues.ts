import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import type { FastifyPluginAsync } from 'fastify';

import { producers } from '../../lib/queue.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

/**
 * Bull Board mounted under /api/admin/queues for inspecting + retrying jobs.
 *
 * Gated behind super_admin because Bull Board exposes destructive operations
 * (cancel, retry, remove, drain) across every queue — editors should not see
 * webhook payloads from other tenants, and authors should not be able to
 * mass-retry image jobs. Cookie auth carries through from the admin SPA: an
 * editor who opens /api/admin/queues in a new tab hits 401/403 before any
 * Bull Board asset loads.
 *
 * The mounted prefix MUST match `setBasePath` exactly — Bull Board's UI
 * builds its own asset URLs from that base.
 */
export const adminQueuesRoutes: FastifyPluginAsync = async (fastify) => {
  // Auth hooks are scoped to this plugin's encapsulation context, so they
  // run for every Bull Board sub-route (UI HTML, JS assets, REST API).
  fastify.addHook('preHandler', requireAdminAuth);
  fastify.addHook('preHandler', requireAdminRole('super_admin'));

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/api/admin/queues');

  createBullBoard({
    queues: producers.rawQueues.map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  await fastify.register(serverAdapter.registerPlugin(), { prefix: '/' });
};
