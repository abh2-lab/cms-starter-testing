import type { DocsData, Mode } from '../types.js';

export function render(data: DocsData, mode: Mode): string {
  return mode === 'compact' ? renderCompact(data) : renderReadable(data);
}

function renderReadable(data: DocsData): string {
  const { baseUrl } = data;
  const lines: string[] = [];
  lines.push('## Taxonomy (categories & tags)');
  lines.push('');
  lines.push(
    'There is **no standalone `/categories` or `/tags` endpoint**. Taxonomy terms ride along on every content payload as a `taxonomy` array:',
  );
  lines.push('');
  lines.push('```json');
  lines.push('"taxonomy": [');
  lines.push('  { "termSlug": "politics",  "termName": "Politics",  "taxonomySlug": "category" },');
  lines.push('  { "termSlug": "election",  "termName": "Election",  "taxonomySlug": "tag" }');
  lines.push(']');
  lines.push('```');
  lines.push('');
  lines.push(
    '`taxonomySlug` tells you whether the term is a category or a tag (or any other taxonomy the publisher has defined).',
  );
  lines.push('');
  lines.push('**Filter content by a term:**');
  lines.push(`pass \`category=<term-slug>\` to the archive or search endpoint. Despite the parameter name, it matches **any** taxonomy term slug — tags included.`);
  lines.push('');
  lines.push('```');
  lines.push(`GET ${baseUrl}/archive/article?category=election`);
  lines.push(`GET ${baseUrl}/search?q=climate&category=politics`);
  lines.push('```');
  lines.push('');
  lines.push(
    'To build a category/tag picker UI, collect the unique terms from a recent archive page (or hardcode the slugs your editorial team uses — they change rarely).',
  );
  return lines.join('\n').trim();
}

function renderCompact(data: DocsData): string {
  const { baseUrl } = data;
  return [
    '## TAXONOMY',
    'no list endpoint. terms embedded in content/archive/search payloads as taxonomy[] = {termSlug,termName,taxonomySlug}',
    `filter: ?category=<term-slug> on ${baseUrl}/archive/:type or ${baseUrl}/search (matches tags too)`,
  ].join('\n');
}
