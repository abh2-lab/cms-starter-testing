import type { FastifyPluginAsync } from 'fastify';
import { listBlockMetasForTheme } from '@cms/blocks';
import { env } from '@cms/config';
import { requireAdminAuth } from '../../middleware/require-auth.js';

// Read-only metadata endpoint for the dev-shipped block manifest. Backs the
// "Add block" picker in the dynamic-page editor — needs block.meta so it can
// render labels + categories and switch on field types.
//
// The matching page-templates endpoint moved to ./page-templates.ts when it
// grew CRUD for user-saved templates (see packages/db/src/schema/page-templates.ts).
// Block definitions remain code-shipped, so this stays read-only.

export const adminBlocksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  fastify.get('/', async () => {
    // Scope the palette to the active theme: a 'basic'/'core' install (the blank
    // starter) sees only the generic core blocks, not the Decode-specific ones.
    return { data: listBlockMetasForTheme(env.ACTIVE_THEME) };
  });
};
