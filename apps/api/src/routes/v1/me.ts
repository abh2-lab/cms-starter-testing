import type { FastifyPluginAsync } from 'fastify';
import { requireApiKey } from '../../middleware/require-api-key.js';

/**
 * Programmatic API (API-key authenticated). `/me` returns the calling key's own
 * identity — the smallest endpoint that proves the requireApiKey path works
 * end-to-end without coupling to a specific scope.
 */
export const v1MeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireApiKey);

  fastify.get(
    '/me',
    {
      schema: {
        tags: ['Identity'],
        summary: "Get the calling API key's identity",
        description:
          'Returns the name, scopes, and tenant ID of the API key used to authenticate this request. Requires Authorization: Bearer header.',
        operationId: 'getMyApiKeyIdentity',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Identity of the API key on the request',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Human-readable label given to the key',
                  },
                  scopes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Permissions granted to this key',
                  },
                  tenantId: {
                    type: 'string',
                    format: 'uuid',
                    nullable: true,
                    description:
                      'Tenant the key is scoped to, or null for a global key',
                  },
                },
                required: ['name', 'scopes'],
              },
            },
            required: ['data'],
          },
          401: {
            description:
              'Missing, invalid, or expired Authorization: Bearer header',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request) => {
    const key = request.apiKey;
    if (!key) {
      throw new Error('apiKey missing — preHandler chain misconfigured');
    }
    return {
      data: { name: key.name, scopes: key.scopes, tenantId: key.tenantId },
    };
  });
};
