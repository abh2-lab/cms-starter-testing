import { render as renderContent } from './sections/content.js';
import { render as renderTaxonomy } from './sections/taxonomy.js';
import { render as renderMenus } from './sections/menus.js';
import { render as renderSettings } from './sections/settings.js';
import { render as renderWebhooks } from './sections/webhooks.js';
import { render as renderSearch } from './sections/search.js';
import { render as renderSubmissions } from './sections/submissions.js';
import type { DocsData, GenerateInput, Mode } from './types.js';

export { loadDocsData } from './data.js';
export { slugifySiteName } from './utils.js';
export type {
  DocsData,
  GenerateInput,
  Mode,
  SectionsResponse,
} from './types.js';

export function generateMarkdown(
  input: GenerateInput,
  data: DocsData,
  mode: Mode,
): string {
  const blocks: string[] = [];
  blocks.push(renderHeader(data, mode));

  if (input.sections.content.include && data.contentTypes.length > 0) {
    blocks.push(renderContent(data, mode));
  }
  if (input.sections.taxonomy.include) {
    blocks.push(renderTaxonomy(data, mode));
  }
  if (input.sections.menus.include) {
    blocks.push(renderMenus(data, mode));
  }
  if (input.sections.settings.include) {
    blocks.push(renderSettings(data, mode));
  }
  if (input.sections.webhooks.include) {
    blocks.push(renderWebhooks(data, mode));
  }
  if (input.sections.search.include) {
    blocks.push(renderSearch(data, mode));
  }
  if (input.sections.submissions.include) {
    blocks.push(renderSubmissions(data, mode));
  }

  const separator = mode === 'compact' ? '\n\n' : '\n\n---\n\n';
  return blocks.join(separator) + '\n';
}

function renderHeader(data: DocsData, mode: Mode): string {
  const generatedOn = new Date().toISOString().slice(0, 10);
  const { siteName, siteUrl, baseUrl } = data;
  if (mode === 'compact') {
    return [
      `# API REFERENCE — ${siteName}`,
      `BASE=${baseUrl} | AUTH=none (anonymous, IP rate-limited)`,
      `generated ${generatedOn}`,
    ].join('\n');
  }
  const lines: string[] = [];
  lines.push(`# ${siteName} — Public API Reference`);
  lines.push('');
  lines.push(`> Generated ${generatedOn}`);
  lines.push(`> Base URL: \`${baseUrl}\``);
  if (!siteUrl) {
    lines.push(
      `> _(Site URL is not configured. Replace \`/api/public\` with your absolute origin.)_`,
    );
  }
  lines.push(
    `> Auth: **none** — every endpoint below is anonymous. Requests are rate-limited per IP. There is no API key to set.`,
  );
  lines.push(
    `> Cache: read endpoints return \`Cache-Control: public, max-age=300, s-maxage=300\` so a CDN can layer on top.`,
  );
  return lines.join('\n');
}
