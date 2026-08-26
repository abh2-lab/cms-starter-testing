import { WEBHOOK_EVENTS } from '@cms/types';
import { code } from '../utils.js';
import type { DocsData, Mode } from '../types.js';

// Per-event hint shown in readable mode. Kept short — full semantics live in
// the API source files referenced from packages/types/webhook-events.ts.
const EVENT_DESCRIPTIONS: Record<string, string> = {
  'content.created': 'a new content row was inserted (any status)',
  'content.updated': 'an existing content row was edited',
  'content.published': 'a row transitioned into the published-and-visible window',
  'content.unpublished': 'a published row was taken down (manual or via unpublish_at)',
  'content.transitioned':
    'a row moved between editorial statuses (draft → in_review → approved → archived). Emitted alongside published/unpublished for subscribers that need the full transition log.',
  'content.deleted': 'a content row was hard-deleted',
  'media.uploaded': 'a new media asset was uploaded',
  'media.processed': 'an uploaded asset finished post-processing (resizes, etc.)',
};

export function render(_data: DocsData, mode: Mode): string {
  return mode === 'compact' ? renderCompact() : renderReadable();
}

function renderReadable(): string {
  const lines: string[] = [];
  lines.push('## Webhooks & Events');
  lines.push('');
  lines.push(
    'Webhooks are **outbound** — the CMS POSTs to a URL you configure in the admin (Settings → Webhooks). There is no public API to subscribe; subscriptions are set up by an admin.',
  );
  lines.push('');
  lines.push('Use webhooks to:');
  lines.push('- revalidate / invalidate your frontend cache when content publishes');
  lines.push('- trigger a downstream search re-index');
  lines.push('- post into Slack or another notification stream');
  lines.push('');
  lines.push('**Available events:**');
  lines.push('');
  for (const ev of WEBHOOK_EVENTS) {
    const desc = EVENT_DESCRIPTIONS[ev] ?? '';
    lines.push(`- ${code(ev)} — ${desc}`);
  }
  lines.push('');
  lines.push('**Delivery contract:**');
  lines.push('- POST with JSON body. Shape: `{ event, contentId | mediaId, slug?, timestamp, ... }` (event-specific extras).');
  lines.push('- Signed with HMAC-SHA256; the signature is in the `X-Webhook-Signature` header. The signing secret is shown **once** when the webhook is created (rotate from the admin if you lost it).');
  lines.push('- Retries with exponential backoff on non-2xx responses. Each delivery attempt is logged and visible in the admin Webhooks page.');
  lines.push('- Treat your receiver as idempotent — duplicate deliveries can happen on retry.');
  return lines.join('\n').trim();
}

function renderCompact(): string {
  return [
    '## WEBHOOKS',
    'outbound. configured in admin. no subscribe API.',
    `events: ${WEBHOOK_EVENTS.join(',')}`,
    'body: {event,contentId|mediaId,slug?,timestamp,...}',
    'sig: X-Webhook-Signature = HMAC-SHA256(body, secret). receiver must be idempotent.',
  ].join('\n');
}
