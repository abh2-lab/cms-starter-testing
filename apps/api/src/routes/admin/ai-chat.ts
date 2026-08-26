import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadAiConfig } from '../../lib/ai/settings.js';
import { runChatLoop } from '../../lib/ai/chat-loop.js';
import { getToolDefinitions } from '../../lib/ai/tools.js';
import { buildSystemPrompt } from '../../lib/ai/system-prompt.js';
import { AiUpstreamError } from '../../lib/ai/openai-compat-client.js';
import type { ChatMessage, ChatStreamEvent } from '../../lib/ai/types.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

const ChatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(100_000),
      }),
    )
    .min(1)
    .max(100),
  // The admin route the user is currently viewing (e.g. 'settings-email'), so
  // the assistant can answer "what is this page?" and tailor navigation. Optional.
  currentRouteName: z.string().max(120).optional(),
});

function sendZodError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: 'Invalid request body',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  });
}

export const adminAiChatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // Admin-readable (not super-admin): the floating panel polls this to decide
  // whether to show itself. Returns ONLY the two booleans — never the key,
  // provider, model, or base URL (those live behind the super-admin config
  // route at /api/admin/settings/ai).
  fastify.get(
    '/status',
    { preHandler: requireAdminRole('admin') },
    async (request) => {
      const session = getSession(request);
      const config = await loadAiConfig(session.user);
      return { enabled: config.enabled, configured: config.configured };
    },
  );

  // The tool-use loop. Streams SSE frames over the POST response. Runs as the
  // logged-in user: the cookie is forwarded into every tool's fastify.inject.
  fastify.post(
    '/chat',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const session = getSession(request);
      const config = await loadAiConfig(session.user);

      if (!config.enabled) {
        return reply.code(403).send({ error: 'The AI assistant is disabled.' });
      }
      if (
        !config.configured ||
        !config.apiKey ||
        !config.model ||
        !config.baseUrl
      ) {
        return reply.code(409).send({
          error:
            'The AI assistant is not configured. Set a provider, model, API key, and base URL in Settings → Infrastructure → AI Assistant.',
        });
      }

      const parsed = ChatBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);

      const history: ChatMessage[] = parsed.data.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: buildSystemPrompt({
            displayName: session.user.displayName,
            role: session.user.role,
            currentRouteName: parsed.data.currentRouteName ?? null,
          }),
        },
        ...history,
      ];

      const cookie = request.headers.cookie ?? '';

      // Take over the raw socket for Server-Sent Events. hijack() stops Fastify
      // from trying to send its own response; we own reply.raw from here.
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Disable proxy buffering (nginx) so tokens flush immediately.
        'X-Accel-Buffering': 'no',
      });

      const emit = (event: ChatStreamEvent): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Abort the upstream provider request if the client disconnects.
      const controller = new AbortController();
      request.raw.on('close', () => controller.abort());

      try {
        await runChatLoop({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages,
          tools: getToolDefinitions(),
          ctx: { fastify, cookie },
          emit,
          signal: controller.signal,
        });
      } catch (e) {
        const message =
          e instanceof AiUpstreamError
            ? `AI provider error (${e.status}): ${e.message}`
            : e instanceof Error
              ? e.message
              : 'AI request failed';
        request.log.error({ err: e }, 'ai chat loop failed');
        emit({ type: 'error', message });
      } finally {
        res.end();
      }
    },
  );
};
