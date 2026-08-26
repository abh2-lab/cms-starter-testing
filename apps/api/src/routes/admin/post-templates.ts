import type { FastifyPluginAsync } from 'fastify';
import { listPostTemplates } from '@cms/blocks';
import { requireAdminAuth } from '../../middleware/require-auth.js';

// Read-only metadata for the dev-shipped post (single) templates. Backs the
// "Template" pickers in the content editor (per-post override) and the
// content-type form (per-type default). Mirrors the blocks endpoint —
// code-shipped, no DB, no writes.

export const adminPostTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  fastify.get('/', async () => {
    return { data: listPostTemplates() };
  });
};
