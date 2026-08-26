import type { DocsData, Mode } from '../types.js';

export function render(data: DocsData, mode: Mode): string {
  return mode === 'compact' ? renderCompact(data) : renderReadable(data);
}

function renderReadable(data: DocsData): string {
  const { baseUrl } = data;
  const lines: string[] = [];
  lines.push('## Search');
  lines.push('');
  lines.push(
    'Full-text search across all published content, backed by Meilisearch. Returns the same item shape as the archive endpoint so you can reuse the same card components.',
  );
  lines.push('');
  lines.push('```');
  lines.push(`GET ${baseUrl}/search?q=<query>`);
  lines.push('```');
  lines.push('');
  lines.push('Query parameters:');
  lines.push('- `q` — search query, 1–200 characters (**required**)');
  lines.push('- `type` — optional content type slug; narrows to one type');
  lines.push('- `category` — optional taxonomy term slug; matches tags too');
  lines.push('- `page` — integer, ≥ 1 (default 1)');
  lines.push('- `pageSize` — integer, 1–50 (default 20)');
  lines.push('');
  lines.push(
    'Returns `{ data: { items, pagination } }`. Each item adds a `contentTypeSlug` field on top of the archive shape so a single results page can mix types.',
  );
  lines.push('');
  lines.push(
    '> If the search backend is briefly down, the endpoint returns an empty result set (and logs a warning server-side) rather than 5xx — so a search outage cannot take the public site down.',
  );
  return lines.join('\n').trim();
}

function renderCompact(data: DocsData): string {
  return [
    '## SEARCH',
    `GET ${data.baseUrl}/search ?q=<1-200>&type=<slug>&category=<term-slug>&page=1+&pageSize=1-50`,
    'item shape = archive item + contentTypeSlug',
    'meili-backed. fails open (empty list) on outage.',
  ].join('\n');
}
