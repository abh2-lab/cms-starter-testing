import { code, formatSubmissionAccess } from '../utils.js';
import type { DocsData, Mode } from '../types.js';

export function render(data: DocsData, mode: Mode): string {
  return mode === 'compact' ? renderCompact(data) : renderReadable(data);
}

function renderReadable(data: DocsData): string {
  const { baseUrl, openSubmissionTypes: open } = data;
  const lines: string[] = [];
  lines.push('## Submissions');
  lines.push('');
  lines.push(
    'Accept content submissions from your readers — they become draft rows in the CMS that an editor reviews before publishing. Per-type access controls who may submit.',
  );
  lines.push('');
  lines.push('```');
  lines.push(`POST ${baseUrl}/submissions`);
  lines.push('Content-Type: application/json');
  lines.push('```');
  lines.push('');
  lines.push('**Body** (all fields required):');
  lines.push('```json');
  lines.push('{');
  lines.push('  "title": "Headline",');
  lines.push('  "body": "Full draft body in plain text or limited HTML",');
  lines.push('  "submitter_name": "Your Name",');
  lines.push('  "submitter_email": "you@example.com",');
  lines.push('  "content_type_slug": "<content-type-slug>"');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('Validation:');
  lines.push('- `title` — 1–500 characters');
  lines.push('- `body` — 1–20 000 characters (HTML is stripped server-side)');
  lines.push('- `submitter_name` — 1–200 characters');
  lines.push('- `submitter_email` — valid email');
  lines.push('- `content_type_slug` — slug of one of the types listed below');
  lines.push('');
  lines.push('Returns `{ success: true, message }` on success (the internal id is never exposed).');
  lines.push('');
  lines.push('**Rate limits:** 5 submissions per hour per IP for guests, 20 per hour per user for logged-in submitters.');
  lines.push('');
  lines.push('**Access levels** are configured per content type in the admin:');
  lines.push('- `none` — submissions closed; returns 403');
  lines.push('- `authenticated` — requires an admin session cookie; guests get 401');
  lines.push('- `public` — anyone, including anonymous guests');
  lines.push('');
  if (open.length > 0) {
    lines.push('**Content types currently accepting submissions:**');
    for (const t of open) {
      lines.push(
        `- ${code(t.slug)} (${t.name}) — ${formatSubmissionAccess(t.submissionAccess)}`,
      );
    }
  } else {
    lines.push(
      '_No content types currently accept submissions. Configure `submission_access` on a content type in the admin to enable this endpoint._',
    );
  }
  return lines.join('\n').trim();
}

function renderCompact(data: DocsData): string {
  const { openSubmissionTypes: open } = data;
  const lines: string[] = [];
  lines.push('## SUBMISSIONS');
  lines.push(`POST ${data.baseUrl}/submissions`);
  lines.push(
    'body: {title:1-500,body:1-20000,submitter_name:1-200,submitter_email:email,content_type_slug:slug}',
  );
  lines.push('returns: {success,message}. id never exposed. html stripped server-side.');
  lines.push('rate: 5/hr guest (IP), 20/hr authed (user)');
  if (open.length > 0) {
    lines.push(
      `open types: ${open.map((t) => `${t.slug}(${t.submissionAccess})`).join(',')}`,
    );
  } else {
    lines.push('open types: <none>');
  }
  return lines.join('\n');
}
