import { readAndValidateFixtures } from './validate.js';
import { SlugResolver } from './resolve.js';
import { seedMedia } from './seed-media.js';
import { seedContentTypes } from './seed-content-types.js';
import { seedTaxonomies } from './seed-taxonomies.js';
import { seedPosts } from './seed-posts.js';
import { seedPages } from './seed-pages.js';
import { seedPageTemplates } from './seed-page-templates.js';
import { seedMenus } from './seed-menus.js';
import { seedRedirects } from './seed-redirects.js';
import { seedSiteSettings } from './seed-site-settings.js';

export { FixtureValidationError } from './errors.js';
export type {
  MediaFixture,
  ContentTypeFixture,
  TaxonomyFixture,
  PostFixture,
  PageFixture,
  PageTemplateFixture,
  MenuFixture,
  RedirectFixture,
  SiteSettingsFixture,
  ParsedFixtures,
} from './schemas.js';

export interface LoadFixturesOptions {
  tenantId: string;
  fixturesDir: string;
  logger?: (line: string) => void;
}

export interface FixtureLoadResult {
  media: number;
  contentTypes: number;
  taxonomies: number;
  taxonomyTerms: number;
  posts: number;
  postSeo: number;
  postTermLinks: number;
  pages: number;
  pageTemplates: number;
  menus: number;
  menuItems: number;
  redirects: number;
  siteSettingsWritten: boolean;
}

// Load every fixture file in `fixturesDir` into `tenantId`. Idempotent — re-
// running is safe; structural rows (CPTs, taxonomies, page templates, pages
// marked system-managed, redirects, site-settings) get UPDATE-on-conflict
// semantics; editor-owned rows (content, non-system pages, existing menu
// items) get DO-NOTHING semantics. Counts reflect "newly inserted" only.
//
// On validation failure: throws FixtureValidationError BEFORE any DB write.
// On per-row insert failure during a phase: throws; rows from prior phases
// remain (no outer transaction — same semantics as loadSampleData).
export async function loadFixtures(
  opts: LoadFixturesOptions,
): Promise<FixtureLoadResult> {
  const log = opts.logger ?? ((line: string): void => { console.log(line); });
  log(`fixture-loader: reading from ${opts.fixturesDir}`);

  const parsed = await readAndValidateFixtures(opts.fixturesDir);
  log(
    `fixture-loader: validated ` +
      `${parsed.media.length} media item(s), ` +
      `${parsed.contentTypes.length} content-type(s), ` +
      `${parsed.taxonomies.length} taxonomy(ies), ` +
      `${parsed.posts.length} post(s), ` +
      `${parsed.pages.length} page(s), ` +
      `${parsed.pageTemplates.length} page-template(s), ` +
      `${parsed.menus.length} menu(s), ` +
      `${parsed.redirects.length} redirect(s)` +
      `${parsed.siteSettings ? ', site-settings present' : ''}`,
  );

  const resolver = new SlugResolver();

  // Media first — every later phase may reference media by filename, so the
  // resolver must be populated before content_types/posts/pages/site-settings.
  const media = await seedMedia({
    tenantId: opts.tenantId,
    fixtures: parsed.media,
    mediaSourceDir: parsed.mediaSourceDir,
    resolver,
  });
  const ct = await seedContentTypes({
    tenantId: opts.tenantId,
    fixtures: parsed.contentTypes,
    resolver,
  });
  const tax = await seedTaxonomies({
    tenantId: opts.tenantId,
    fixtures: parsed.taxonomies,
    resolver,
  });
  const posts = await seedPosts({
    tenantId: opts.tenantId,
    fixtures: parsed.posts,
    resolver,
  });
  const pages = await seedPages({
    tenantId: opts.tenantId,
    fixtures: parsed.pages,
    resolver,
  });
  const pageTemplates = await seedPageTemplates({
    tenantId: opts.tenantId,
    fixtures: parsed.pageTemplates,
  });
  const menus = await seedMenus({
    tenantId: opts.tenantId,
    fixtures: parsed.menus,
    resolver,
  });
  const redirects = await seedRedirects({
    tenantId: opts.tenantId,
    fixtures: parsed.redirects,
  });
  const siteSettings = await seedSiteSettings({
    tenantId: opts.tenantId,
    fixture: parsed.siteSettings,
    resolver,
  });

  return {
    media: media.media,
    contentTypes: ct.contentTypes,
    taxonomies: tax.taxonomies,
    taxonomyTerms: tax.taxonomyTerms,
    posts: posts.posts,
    postSeo: posts.postSeo,
    postTermLinks: posts.postTermLinks,
    pages: pages.pages,
    pageTemplates: pageTemplates.pageTemplates,
    menus: menus.menus,
    menuItems: menus.menuItems,
    redirects: redirects.redirects,
    siteSettingsWritten: siteSettings.siteSettingsWritten,
  };
}
