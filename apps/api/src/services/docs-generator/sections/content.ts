import { code, renderFieldsTable } from '../utils.js';
import type { DocsData, Mode } from '../types.js';

export function render(data: DocsData, mode: Mode): string {
  return mode === 'compact' ? renderCompact(data) : renderReadable(data);
}

function renderReadable(data: DocsData): string {
  const { contentTypes, baseUrl } = data;
  if (contentTypes.length === 0) {
    return '## Content\n\n_No content types selected._';
  }

  const lines: string[] = [];
  lines.push('## Content');
  lines.push('');
  lines.push(
    'Content is organised by **type**. Each type has its own pair of endpoints — one for paginated listings, one for single items. All published rows are visible; drafts, scheduled (until due), and archived rows are filtered out.',
  );
  lines.push('');
  lines.push(
    '> Responses are cached for 5 minutes. A `Cache-Control: public, max-age=300, s-maxage=300` header lets a CDN cache on top of that.',
  );
  lines.push('');
  lines.push('**Shared item fields** (returned by both endpoints):');
  lines.push('- `id` — UUID');
  lines.push('- `title`');
  lines.push('- `slug`');
  lines.push('- `publishedAt` — ISO timestamp, may be null');
  lines.push('- `author` — `{ displayName }` or null');
  lines.push('- `customFields` — object whose shape comes from the content type (see field tables below)');
  lines.push('- `taxonomy` — array of `{ termSlug, termName, taxonomySlug }`');
  lines.push('');

  for (const t of contentTypes) {
    lines.push(`### ${t.name}`);
    lines.push('');
    if (t.description) {
      lines.push(`> ${t.description}`);
      lines.push('');
    }
    lines.push(`**List ${t.name.toLowerCase()} items**`);
    lines.push('```');
    lines.push(`GET ${baseUrl}/archive/${t.slug}`);
    lines.push('```');
    lines.push('Query parameters:');
    lines.push('- `page` — integer, ≥ 1 (default 1)');
    lines.push('- `pageSize` — integer, 1–100 (default 20)');
    lines.push('- `category` — optional taxonomy term slug filter');
    lines.push('');
    lines.push(`Returns \`{ data: { items: [...], pagination: { page, pageSize, total, totalPages } } }\`. Each item also has \`heroImageUrl\`, \`excerpt\`, and \`featured\`. Items sort newest-first.`);
    lines.push('');
    lines.push(`**Fetch a single ${t.name.toLowerCase()} by slug**`);
    lines.push('```');
    lines.push(`GET ${baseUrl}/content/${t.slug}/:slug`);
    lines.push('```');
    lines.push(
      `Returns \`{ data: <item> }\` with the shared fields above plus a \`seo\` object (\`metaTitle\`, \`metaDescription\`, \`ogImageUrl\`, \`twitterImageUrl\`, \`canonicalUrl\`, \`robotsIndex\`, \`robotsFollow\`, \`schemaType\`), or 404 if the slug doesn't exist or falls outside the publish window.`,
    );
    lines.push('');

    const table = renderFieldsTable(t.fieldDefinitions);
    if (table) {
      lines.push(`**Custom fields on ${t.name}:**`);
      lines.push('');
      lines.push(table);
      lines.push('');
    } else {
      lines.push(`_${t.name} has no custom fields beyond the shared ones._`);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

function renderCompact(data: DocsData): string {
  const { contentTypes, baseUrl } = data;
  if (contentTypes.length === 0) return '## CONTENT\n_no types selected_';

  const lines: string[] = [];
  lines.push('## CONTENT');
  lines.push(
    'shared item fields: id,title,slug,publishedAt,author,customFields,taxonomy',
  );
  lines.push('archive items also: heroImageUrl,excerpt,featured');
  lines.push('only published items visible. cached 5m.');
  lines.push('');
  for (const t of contentTypes) {
    lines.push(`### ${t.slug}`);
    lines.push(
      `GET ${baseUrl}/archive/${t.slug} ?page=1+&pageSize=1-100&category=<term-slug>`,
    );
    lines.push(`GET ${baseUrl}/content/${t.slug}/:slug`);
    if (t.fieldDefinitions.fields.length > 0) {
      const fields = t.fieldDefinitions.fields
        .map(
          (f) =>
            `${f.name}:${f.type}${f.required ? '*' : ''}`,
        )
        .join(',');
      lines.push(`fields: ${fields}`);
    }
  }
  return lines.join('\n');
}

// Touch `code` so eslint doesn't complain about the unused import — `code()`
// is used elsewhere in the renderers and kept here for symmetry across files.
void code;
