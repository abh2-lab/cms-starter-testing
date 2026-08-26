import { code } from '../utils.js';
import type { DocsData, Mode } from '../types.js';

export function render(data: DocsData, mode: Mode): string {
  return mode === 'compact' ? renderCompact(data) : renderReadable(data);
}

function renderReadable(data: DocsData): string {
  const { menus, baseUrl } = data;
  const lines: string[] = [];
  lines.push('## Menus');
  lines.push('');
  lines.push(
    'Menus are named navigation trees. Each menu has a unique `slug` (called "location" on the API for clarity). Items can link to a static URL or to a content row — content-linked items carry the resolved `contentSlug` + `contentType` so you can build the destination URL without a second round trip.',
  );
  lines.push('');
  lines.push('```');
  lines.push(`GET ${baseUrl}/menus/:location`);
  lines.push('```');
  lines.push('');
  lines.push(
    'Returns `{ data: { id, name, slug, items: [...] } }`. Each item is shaped:',
  );
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "id": "<uuid>",');
  lines.push('  "label": "About Us",');
  lines.push('  "url": "/about" | null,');
  lines.push('  "contentSlug": "about-us" | null,');
  lines.push('  "contentType": "page" | null,');
  lines.push('  "sortOrder": 1,');
  lines.push('  "children": [/* same shape, recursive */]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  if (menus.length > 0) {
    lines.push('**Active menus on this site:**');
    for (const m of menus) {
      lines.push(`- ${code(m.slug)} — ${m.name}`);
    }
  } else {
    lines.push(
      '_No active menus are configured yet. Once an editor creates one in the admin, its slug will appear here._',
    );
  }
  lines.push('');
  lines.push(
    'Returns 404 when no active menu matches. Tree depth is capped at 10 to guard against parent-cycle data bugs.',
  );
  return lines.join('\n').trim();
}

function renderCompact(data: DocsData): string {
  const { menus, baseUrl } = data;
  const slugs =
    menus.length > 0
      ? menus.map((m) => m.slug).join(',')
      : '<none configured>';
  return [
    '## MENUS',
    `GET ${baseUrl}/menus/:location`,
    'item: {id,label,url,contentSlug,contentType,sortOrder,children[]}',
    `slugs: ${slugs}`,
  ].join('\n');
}
