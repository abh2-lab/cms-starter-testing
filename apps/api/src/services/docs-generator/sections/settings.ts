import type { DocsData, Mode } from '../types.js';

export function render(data: DocsData, mode: Mode): string {
  return mode === 'compact' ? renderCompact(data) : renderReadable(data);
}

function renderReadable(data: DocsData): string {
  const { baseUrl } = data;
  const lines: string[] = [];
  lines.push('## Site Settings & SEO');
  lines.push('');
  lines.push(
    'Global per-site configuration. Populate your `<head>` defaults, footer copy, social links, analytics, and feature toggles from here. Image fields are resolved to display URLs — your frontend never sees raw storage keys.',
  );
  lines.push('');
  lines.push('```');
  lines.push(`GET ${baseUrl}/site-settings`);
  lines.push('```');
  lines.push('');
  lines.push(
    'Returns `{ data: <settings> | null }`. `data` is `null` only when no settings row has been saved for this tenant yet.',
  );
  lines.push('');
  lines.push('**Fields:**');
  lines.push('- `siteName`, `siteUrl`, `siteDescription`');
  lines.push('- `logoUrl`, `faviconUrl`, `ogImageUrl` — resolved URLs (may be null)');
  lines.push('- `socialLinks` — free-form object, shape depends on what the publisher configured');
  lines.push('- `defaultMetaTitleSuffix` — appended to per-page meta titles');
  lines.push('- `defaultRobots` — e.g. `"index,follow"`');
  lines.push('- `googleSiteVerification`, `analyticsId`');
  lines.push('- `commentsEnabled`, `registrationEnabled`, `maintenanceMode` — feature flags');
  lines.push('- `customHeadScripts`, `customBodyScripts` — raw HTML to inject into the page (treat as trusted publisher input)');
  lines.push('- `extra` — per-tenant unstructured config (ticker headlines, impact stats, footer coordinates, etc.)');
  lines.push('');
  lines.push(
    'When `maintenanceMode` is `true`, render a maintenance page and skip the rest of your routing.',
  );
  return lines.join('\n').trim();
}

function renderCompact(data: DocsData): string {
  return [
    '## SETTINGS',
    `GET ${data.baseUrl}/site-settings`,
    'fields: siteName,siteUrl,siteDescription,logoUrl,faviconUrl,ogImageUrl,socialLinks,defaultMetaTitleSuffix,defaultRobots,googleSiteVerification,analyticsId,commentsEnabled,registrationEnabled,maintenanceMode,customHeadScripts,customBodyScripts,extra',
    'data may be null if no settings row exists. images come pre-resolved as URLs.',
  ].join('\n');
}
