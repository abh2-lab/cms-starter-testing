import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { getBlock, getTemplate } from '@cms/blocks';
import { isReservedContentTypeSlug } from '../../lib/reserved-content-type-slugs.js';
import { IssueCollector } from './errors.js';
import { collectMediaSentinels } from './resolve.js';
import {
  ContentTypesFileSchema,
  TaxonomiesFileSchema,
  PostsFileSchema,
  PagesFileSchema,
  PageTemplatesFileSchema,
  MenusFileSchema,
  RedirectsFileSchema,
  SiteSettingsFixtureSchema,
  MediaFileSchema,
  type ParsedFixtures,
} from './schemas.js';

// Each fixture JSON file is optional. Missing = skip that phase entirely.
// Present = must be valid JSON, valid against the schema, and pass cross-
// validation against the block / template registries before any DB write.

type FixtureFileName =
  | 'media.json'
  | 'content-types.json'
  | 'taxonomies.json'
  | 'posts.json'
  | 'pages.json'
  | 'page-templates.json'
  | 'menus.json'
  | 'redirects.json'
  | 'site-settings.json';

async function readJsonIfPresent(
  dir: string,
  filename: FixtureFileName,
): Promise<unknown> {
  const fullPath = path.join(dir, filename);
  try {
    const raw = await fs.readFile(fullPath, 'utf8');
    return JSON.parse(raw);
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return undefined;
    }
    if (err instanceof SyntaxError) {
      throw new Error(`${filename}: invalid JSON — ${err.message}`, {
        cause: err,
      });
    }
    throw err;
  }
}

function parseWithSchema<S extends z.ZodTypeAny>(
  filename: FixtureFileName,
  raw: unknown,
  schema: S,
  issues: IssueCollector,
): z.infer<S> | null {
  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const pathStr = issue.path.length > 0 ? issue.path.join('.') : '';
      issues.add(filename, pathStr, issue.message);
    }
    return null;
  }
  return result.data as z.infer<S>;
}

export async function readAndValidateFixtures(
  dir: string,
): Promise<ParsedFixtures> {
  const issues = new IssueCollector();

  const rawMedia = await readJsonIfPresent(dir, 'media.json');
  const rawContentTypes = await readJsonIfPresent(dir, 'content-types.json');
  const rawTaxonomies = await readJsonIfPresent(dir, 'taxonomies.json');
  const rawPosts = await readJsonIfPresent(dir, 'posts.json');
  const rawPages = await readJsonIfPresent(dir, 'pages.json');
  const rawPageTemplates = await readJsonIfPresent(dir, 'page-templates.json');
  const rawMenus = await readJsonIfPresent(dir, 'menus.json');
  const rawRedirects = await readJsonIfPresent(dir, 'redirects.json');
  const rawSiteSettings = await readJsonIfPresent(dir, 'site-settings.json');

  const media =
    rawMedia === undefined
      ? []
      : (parseWithSchema('media.json', rawMedia, MediaFileSchema, issues) ?? []);
  const contentTypes =
    rawContentTypes === undefined
      ? []
      : (parseWithSchema(
          'content-types.json',
          rawContentTypes,
          ContentTypesFileSchema,
          issues,
        ) ?? []);
  const taxonomies =
    rawTaxonomies === undefined
      ? []
      : (parseWithSchema(
          'taxonomies.json',
          rawTaxonomies,
          TaxonomiesFileSchema,
          issues,
        ) ?? []);
  const posts =
    rawPosts === undefined
      ? []
      : (parseWithSchema('posts.json', rawPosts, PostsFileSchema, issues) ?? []);
  const pages =
    rawPages === undefined
      ? []
      : (parseWithSchema('pages.json', rawPages, PagesFileSchema, issues) ?? []);
  const pageTemplates =
    rawPageTemplates === undefined
      ? []
      : (parseWithSchema(
          'page-templates.json',
          rawPageTemplates,
          PageTemplatesFileSchema,
          issues,
        ) ?? []);
  const menus =
    rawMenus === undefined
      ? []
      : (parseWithSchema('menus.json', rawMenus, MenusFileSchema, issues) ?? []);
  const redirects =
    rawRedirects === undefined
      ? []
      : (parseWithSchema(
          'redirects.json',
          rawRedirects,
          RedirectsFileSchema,
          issues,
        ) ?? []);
  const siteSettings =
    rawSiteSettings === undefined
      ? null
      : (parseWithSchema(
          'site-settings.json',
          rawSiteSettings,
          SiteSettingsFixtureSchema,
          issues,
        ) ?? null);

  // ─── cross-validation ──────────────────────────────────────────────────

  // Unique slug checks per file.
  assertUniqueSlugs('media.json', media, (m) => m.filename, issues);
  assertUniqueSlugs('content-types.json', contentTypes, (c) => c.slug, issues);

  // Reject CPT fixtures whose slug shadows a first-class entity (pages, media,
  // tenants, users, settings, etc.). Mirrors the admin POST/PATCH guard in
  // routes/admin/content-types.ts so the same check applies from either path.
  for (const ct of contentTypes) {
    if (isReservedContentTypeSlug(ct.slug)) {
      issues.add(
        'content-types.json',
        ct.slug,
        `slug "${ct.slug}" is reserved — it shadows a first-class entity (pages, media, tenants, users, settings, taxonomies, terms, etc.) and would mislead editors`,
      );
    }
  }

  assertUniqueSlugs('taxonomies.json', taxonomies, (t) => t.slug, issues);
  assertUniquePosts(posts, issues);
  assertUniqueSlugs('pages.json', pages, (p) => p.slug, issues);
  assertUniqueSlugs(
    'page-templates.json',
    pageTemplates,
    (t) => t.key,
    issues,
  );
  assertUniqueSlugs('menus.json', menus, (m) => m.slug, issues);
  assertUniqueRedirects(redirects, issues);

  // Flat-URL cross-fixture slug-collision check. Mirrors the admin write
  // guard in lib/slug-collision.ts: static pages, category terms and tag
  // terms share the publication root, so each slug can only belong to one.
  // Only enforced for taxonomies whose own slug is 'categories' or 'tags' —
  // custom taxonomies aren't user-facing URLs and can collide freely.
  const pageSlugs = new Set(pages.map((p) => p.slug));
  for (const tax of taxonomies) {
    if (tax.slug !== 'categories' && tax.slug !== 'tags') continue;
    const kindLabel = tax.slug === 'categories' ? 'category' : 'tag';
    for (const term of tax.terms) {
      if (pageSlugs.has(term.slug)) {
        issues.add(
          'taxonomies.json',
          `${tax.slug}.terms.${term.slug}`,
          `slug "${term.slug}" collides with a static page in pages.json — pages, categories and tags share the publication root and slugs must be unique across the three. Rename the ${kindLabel} term or the page.`,
        );
      }
    }
  }
  // And the reverse — every category/tag slug that collides with a page
  // surfaces from the page side too, so the error appears under
  // pages.json for editors browsing fixtures from that angle.
  const taxonomyTermSlugByKind = new Map<string, 'category' | 'tag'>();
  for (const tax of taxonomies) {
    if (tax.slug !== 'categories' && tax.slug !== 'tags') continue;
    const kind: 'category' | 'tag' =
      tax.slug === 'categories' ? 'category' : 'tag';
    for (const term of tax.terms) taxonomyTermSlugByKind.set(term.slug, kind);
  }
  for (const page of pages) {
    const collidesWithKind = taxonomyTermSlugByKind.get(page.slug);
    if (collidesWithKind) {
      issues.add(
        'pages.json',
        page.slug,
        `slug "${page.slug}" collides with a ${collidesWithKind} in taxonomies.json — pages, categories and tags share the publication root and slugs must be unique across the three.`,
      );
    }
  }

  // Taxonomy: term slug unique within taxonomy + parent_slug must reference
  // a sibling term in the same taxonomy.
  for (const tax of taxonomies) {
    const seenTermSlugs = new Set<string>();
    for (const term of tax.terms) {
      if (seenTermSlugs.has(term.slug)) {
        issues.add(
          'taxonomies.json',
          `${tax.slug}.terms`,
          `duplicate term slug "${term.slug}"`,
        );
      }
      seenTermSlugs.add(term.slug);
    }
    for (const term of tax.terms) {
      if (term.parent_slug !== undefined && !seenTermSlugs.has(term.parent_slug)) {
        issues.add(
          'taxonomies.json',
          `${tax.slug}.terms.${term.slug}.parent_slug`,
          `parent_slug "${term.parent_slug}" not found in taxonomy "${tax.slug}"`,
        );
      }
    }
    if (tax.kind === 'tag' && tax.is_hierarchical) {
      issues.add(
        'taxonomies.json',
        `${tax.slug}.is_hierarchical`,
        'tags cannot be hierarchical',
      );
    }
  }

  // Posts must reference an in-fixture content_type and existing taxonomy terms.
  const contentTypeSlugs = new Set(contentTypes.map((c) => c.slug));
  const taxonomyTermSet = new Set<string>();
  for (const tax of taxonomies) {
    for (const term of tax.terms) {
      taxonomyTermSet.add(`${tax.slug}::${term.slug}`);
    }
  }
  for (const post of posts) {
    if (!contentTypeSlugs.has(post.content_type_slug)) {
      issues.add(
        'posts.json',
        post.slug,
        `unknown content_type_slug "${post.content_type_slug}"`,
      );
    }
    for (const ref of post.taxonomy_terms) {
      if (!taxonomyTermSet.has(`${ref.taxonomy_slug}::${ref.term_slug}`)) {
        issues.add(
          'posts.json',
          post.slug,
          `taxonomy_terms references missing term "${ref.term_slug}" in taxonomy "${ref.taxonomy_slug}"`,
        );
      }
    }
  }

  // Pages: dynamic pages must reference known block_keys and (if set) a known
  // template_key. Static pages must have html (css optional). Either kind may
  // have an empty body — that's a valid placeholder state.
  for (const page of pages) {
    if (page.type === 'dynamic') {
      if (page.template_key !== undefined && page.template_key !== null) {
        if (!getTemplate(page.template_key)) {
          issues.add(
            'pages.json',
            page.slug,
            `unknown template_key "${page.template_key}" — not in the code-shipped template registry`,
          );
        }
      }
      for (const [i, block] of page.blocks.entries()) {
        if (!getBlock(block.block_key)) {
          issues.add(
            'pages.json',
            `${page.slug}.blocks[${i}]`,
            `unknown block_key "${block.block_key}" — not in the block registry`,
          );
        }
      }
      if (page.html !== undefined && page.html !== null) {
        issues.add(
          'pages.json',
          page.slug,
          'dynamic pages must not set "html" — use "blocks" instead',
        );
      }
    } else {
      // static
      if (page.blocks.length > 0) {
        issues.add(
          'pages.json',
          page.slug,
          'static pages must not set "blocks" — use "html" + "css" instead',
        );
      }
      if (page.template_key !== undefined && page.template_key !== null) {
        issues.add(
          'pages.json',
          page.slug,
          'static pages must not set "template_key"',
        );
      }
    }
  }

  // Page templates: every block_key must exist.
  for (const tpl of pageTemplates) {
    for (const [i, key] of tpl.block_keys.entries()) {
      if (!getBlock(key)) {
        issues.add(
          'page-templates.json',
          `${tpl.key}.block_keys[${i}]`,
          `unknown block_key "${key}" — not in the block registry`,
        );
      }
    }
  }

  // Menu items with parent_label must reference a sibling label in the same menu.
  for (const menu of menus) {
    const labels = new Set(menu.items.map((i) => i.label));
    for (const item of menu.items) {
      if (item.parent_label !== undefined && !labels.has(item.parent_label)) {
        issues.add(
          'menus.json',
          `${menu.slug}.items.${item.label}.parent_label`,
          `parent_label "${item.parent_label}" not found in menu "${menu.slug}"`,
        );
      }
    }
  }

  // ─── media cross-references ────────────────────────────────────────────
  //
  // Walk every payload that may carry `{$media: "..."}` sentinels and verify
  // each referenced filename is in media.json. Also verify each media.json
  // entry's source file exists on disk under <dir>/media/.
  const mediaFilenames = new Set(media.map((m) => m.filename));
  const referenced = new Set<string>();
  for (const post of posts) {
    collectMediaSentinels(post.custom_fields, referenced);
    if (post.seo !== undefined) collectMediaSentinels(post.seo, referenced);
  }
  for (const page of pages) {
    collectMediaSentinels(page.seo, referenced);
    for (const block of page.blocks) {
      collectMediaSentinels(block.fields, referenced);
      collectMediaSentinels(block.options, referenced);
    }
  }
  if (siteSettings !== null) {
    collectMediaSentinels(siteSettings.favicon_key, referenced);
    collectMediaSentinels(siteSettings.logo_key, referenced);
    collectMediaSentinels(siteSettings.default_og_image_key, referenced);
    if (siteSettings.social_links !== undefined) {
      collectMediaSentinels(siteSettings.social_links, referenced);
    }
    if (siteSettings.extra !== undefined) {
      collectMediaSentinels(siteSettings.extra, referenced);
    }
  }
  for (const filename of referenced) {
    if (!mediaFilenames.has(filename)) {
      issues.addRaw(
        `media reference "$media: ${filename}" not defined in media.json`,
      );
    }
  }

  // Each media.json entry's source file must exist on disk. Catch this at
  // validation time so the loader doesn't fail mid-upload on missing files.
  const mediaSourceDir = path.join(dir, 'media');
  for (const entry of media) {
    const srcPath = path.join(mediaSourceDir, entry.filename);
    try {
      const stat = await fs.stat(srcPath);
      if (!stat.isFile()) {
        issues.add(
          'media.json',
          entry.filename,
          `source path is not a regular file: ${srcPath}`,
        );
      }
    } catch (err: unknown) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'ENOENT'
      ) {
        issues.add(
          'media.json',
          entry.filename,
          `source file missing — expected at ${srcPath}`,
        );
      } else {
        throw err;
      }
    }
  }

  issues.throwIfAny();

  return {
    media,
    contentTypes,
    taxonomies,
    posts,
    pages,
    pageTemplates,
    menus,
    redirects,
    siteSettings,
    mediaSourceDir,
  };
}

function assertUniqueSlugs<T>(
  file: FixtureFileName,
  rows: readonly T[],
  pick: (row: T) => string,
  issues: IssueCollector,
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const slug = pick(row);
    if (seen.has(slug)) {
      issues.add(file, slug, `duplicate slug/key "${slug}"`);
    }
    seen.add(slug);
  }
}

function assertUniquePosts(
  posts: readonly { content_type_slug: string; slug: string }[],
  issues: IssueCollector,
): void {
  const seen = new Set<string>();
  for (const p of posts) {
    const key = `${p.content_type_slug}::${p.slug}`;
    if (seen.has(key)) {
      issues.add(
        'posts.json',
        key,
        `duplicate post (content_type_slug + slug) "${p.content_type_slug}/${p.slug}"`,
      );
    }
    seen.add(key);
  }
}

function assertUniqueRedirects(
  redirects: readonly { from_path: string }[],
  issues: IssueCollector,
): void {
  const seen = new Set<string>();
  for (const r of redirects) {
    if (seen.has(r.from_path)) {
      issues.add('redirects.json', r.from_path, `duplicate from_path "${r.from_path}"`);
    }
    seen.add(r.from_path);
  }
}
