import { z } from 'zod';
import {
  FieldTypeSchema,
  FieldValidationsSchema,
  SubFieldTypeSchema,
} from '@cms/types';

// Fixture-file schemas. These are AUTHOR-friendly shapes — id columns and
// derived fields (`order` on CPT fields, `id` on page block instances) are
// generated at seed time rather than required in the JSON, so the agent
// writing a fixture stays focused on content rather than UUIDs.
//
// Where a DB column accepts free-form JSON (pages.seo, content.customFields,
// site_settings.socialLinks/extra), the fixture schema accepts
// `record(string, unknown)` and lets the row pass through verbatim.
//
// All top-level fixture objects use `.strict()` so a typo in a JSON key (e.g.
// `"slugg"` instead of `"slug"`) fails fast instead of being silently dropped.

// ─── shared building blocks ──────────────────────────────────────────────

const snakeCase = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier');

const lowerDashed = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/, 'must be a lowercase-dashed identifier');

// Status enum — mirrors content_status pgEnum.
const StatusSchema = z.enum([
  'draft',
  'in_review',
  'approved',
  'scheduled',
  'published',
  'archived',
]);

// ─── media.json ───────────────────────────────────────────────────────────
//
// The fixture-space `filename` is the lookup name posts/pages reference via
// `{"$media": "..."}` sentinels. It is NOT the storage_key (which is
// generated at upload time). The actual file lives at
// `<fixturesDir>/media/<filename>` and is uploaded to S3 at seed time.

export const MediaFixtureSchema = z
  .object({
    filename: z.string().min(1).regex(/^[A-Za-z0-9._-]+$/, 'must be a safe filename (alphanumerics, dot, dash, underscore only)'),
    mime_type: z.string().min(1),
    alt: z.string().optional(),
    caption: z.string().optional(),
    folder: lowerDashed.optional(),
  })
  .strict();

export type MediaFixture = z.infer<typeof MediaFixtureSchema>;
export const MediaFileSchema = z.array(MediaFixtureSchema);

// A `{$media: "filename"}` sentinel — the explicit shape posts/pages use to
// reference a media item by its fixture-space filename. The loader walks
// payloads recursively, replaces these with the resolved storage_key, then
// inserts the rewritten payload. Two reasons it's an object (not a magic
// string like "media:filename.jpg"):
//   1. zod can validate the shape; a typo'd `{$medai: ...}` fails to parse.
//   2. JSON readers/editors render it as structured data, not opaque text.
export const MediaSentinelSchema = z
  .object({ $media: z.string().min(1) })
  .strict();

export type MediaSentinel = z.infer<typeof MediaSentinelSchema>;

// A media reference field that accepts EITHER a literal storage_key string
// (for the rare case an admin already uploaded the file) OR a sentinel.
const MediaRef = z.union([z.string(), MediaSentinelSchema]);

// ─── content-types.json ───────────────────────────────────────────────────

const SubFieldFixtureSchema = z
  .object({
    name: snakeCase,
    label: z.string().min(1),
    type: SubFieldTypeSchema,
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
  })
  .strict();

const FieldFixtureSchema = z
  .object({
    name: snakeCase,
    label: z.string().min(1),
    type: FieldTypeSchema,
    required: z.boolean().default(false),
    helpText: z.string().optional(),
    validations: FieldValidationsSchema,
    default: z.unknown().optional(),
    subFields: z.array(SubFieldFixtureSchema).optional(),
  })
  .strict();

export const ContentTypeFixtureSchema = z
  .object({
    slug: lowerDashed,
    name: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    fields: z.array(FieldFixtureSchema).default([]),
    settings: z.record(z.string(), z.unknown()).default({}),
    previewPath: z.string().nullish(),
    submissionAccess: z
      .enum(['none', 'authenticated', 'public'])
      .default('none'),
  })
  .strict();

export type ContentTypeFixture = z.infer<typeof ContentTypeFixtureSchema>;
export const ContentTypesFileSchema = z.array(ContentTypeFixtureSchema);

// ─── taxonomies.json ──────────────────────────────────────────────────────

const TermFixtureSchema = z
  .object({
    slug: lowerDashed,
    name: z.string().min(1),
    description: z.string().optional(),
    parent_slug: lowerDashed.optional(),
    sort_order: z.number().int().default(0),
  })
  .strict();

export const TaxonomyFixtureSchema = z
  .object({
    slug: lowerDashed,
    name: z.string().min(1),
    // Plain-language summary of what this taxonomy is for. Surfaces on the
    // public /category/<slug> and /tag/<slug> hero rows when set.
    description: z.string().optional(),
    kind: z.enum(['category', 'tag']).default('category'),
    is_hierarchical: z.boolean().default(false),
    terms: z.array(TermFixtureSchema).default([]),
  })
  .strict();

export type TaxonomyFixture = z.infer<typeof TaxonomyFixtureSchema>;
export const TaxonomiesFileSchema = z.array(TaxonomyFixtureSchema);

// ─── posts.json ───────────────────────────────────────────────────────────

const PostSeoFixtureSchema = z
  .object({
    meta_title: z.string().optional(),
    meta_description: z.string().optional(),
    meta_keywords: z.array(z.string()).optional(),
    og_title: z.string().optional(),
    og_description: z.string().optional(),
    og_image_key: MediaRef.optional(),
    canonical_url: z.string().optional(),
    robots_index: z.boolean().optional(),
    robots_follow: z.boolean().optional(),
    schema_type: z.string().optional(),
  })
  .strict();

// Explicit per-term references — the fixture says exactly which taxonomy + term
// to link, so the loader doesn't have to guess "category" vs "tags" by naming
// convention. Easier to grep, easier to validate, no magic.
const PostTaxonomyTermRefSchema = z
  .object({
    taxonomy_slug: lowerDashed,
    term_slug: lowerDashed,
  })
  .strict();

export const PostFixtureSchema = z
  .object({
    content_type_slug: lowerDashed,
    slug: lowerDashed,
    title: z.string().min(1),
    status: StatusSchema.default('draft'),
    featured: z.boolean().default(false),
    sort_order: z.number().int().default(0),
    publish_at: z.string().datetime().nullish(),
    published_at: z.string().datetime().nullish(),
    locale: z.string().default('en'),
    custom_fields: z.record(z.string(), z.unknown()).default({}),
    taxonomy_terms: z.array(PostTaxonomyTermRefSchema).default([]),
    seo: PostSeoFixtureSchema.optional(),
  })
  .strict();

export type PostFixture = z.infer<typeof PostFixtureSchema>;
export const PostsFileSchema = z.array(PostFixtureSchema);

// ─── pages.json ───────────────────────────────────────────────────────────

const PageBlockFixtureSchema = z
  .object({
    block_key: lowerDashed,
    fields: z.record(z.string(), z.unknown()).default({}),
    options: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const PageFixtureSchema = z
  .object({
    slug: lowerDashed,
    title: z.string().min(1),
    type: z.enum(['static', 'dynamic']),
    status: StatusSchema.default('published'),
    html: z.string().nullish(),
    css: z.string().nullish(),
    template_key: lowerDashed.nullish(),
    blocks: z.array(PageBlockFixtureSchema).default([]),
    layout_template: z.string().nullish(),
    seo: z.record(z.string(), z.unknown()).default({}),
    system_managed: z.boolean().default(true),
    locale: z.string().default('en'),
    publish_at: z.string().datetime().nullish(),
    published_at: z.string().datetime().nullish(),
  })
  .strict();

export type PageFixture = z.infer<typeof PageFixtureSchema>;
export const PagesFileSchema = z.array(PageFixtureSchema);

// ─── page-templates.json ──────────────────────────────────────────────────
//
// USER-saved templates only. Code-shipped templates in
// packages/blocks/src/templates/ are immutable and not seeded from fixtures.
// Per the schema comment in packages/db/src/schema/page-templates.ts, only
// the ordered block_keys are stored — defaults live in the block manifest.

export const PageTemplateFixtureSchema = z
  .object({
    key: lowerDashed,
    name: z.string().min(1),
    description: z.string().optional(),
    block_keys: z.array(lowerDashed).default([]),
  })
  .strict();

export type PageTemplateFixture = z.infer<typeof PageTemplateFixtureSchema>;
export const PageTemplatesFileSchema = z.array(PageTemplateFixtureSchema);

// ─── menus.json ───────────────────────────────────────────────────────────

const MenuItemFixtureSchema = z
  .object({
    label: z.string().min(1),
    url: z.string().optional(),
    content_type_slug: lowerDashed.optional(),
    content_slug: lowerDashed.optional(),
    parent_label: z.string().optional(),
    sort_order: z.number().int().default(0),
    open_in_new_tab: z.boolean().default(false),
    icon: z.string().optional(),
    is_active: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) =>
      typeof v.url === 'string' ||
      (typeof v.content_type_slug === 'string' &&
        typeof v.content_slug === 'string'),
    {
      message:
        'menu item must define either `url` or BOTH `content_type_slug` and `content_slug`',
    },
  );

export const MenuFixtureSchema = z
  .object({
    slug: lowerDashed,
    name: z.string().min(1),
    description: z.string().optional(),
    is_active: z.boolean().default(true),
    items: z.array(MenuItemFixtureSchema).default([]),
  })
  .strict();

export type MenuFixture = z.infer<typeof MenuFixtureSchema>;
export const MenusFileSchema = z.array(MenuFixtureSchema);

// ─── redirects.json ───────────────────────────────────────────────────────

export const RedirectFixtureSchema = z
  .object({
    from_path: z.string().min(1),
    to_path: z.string().min(1),
    redirect_type: z.number().int().default(301),
    is_active: z.boolean().default(true),
    notes: z.string().optional(),
  })
  .strict();

export type RedirectFixture = z.infer<typeof RedirectFixtureSchema>;
export const RedirectsFileSchema = z.array(RedirectFixtureSchema);

// ─── site-settings.json ───────────────────────────────────────────────────

export const SiteSettingsFixtureSchema = z
  .object({
    site_name: z.string().min(1),
    site_url: z.string().url(),
    site_description: z.string().optional(),
    contact_email: z.string().email().optional(),
    logo_key: MediaRef.optional(),
    favicon_key: MediaRef.optional(),
    default_og_image_key: MediaRef.optional(),
    default_meta_title_suffix: z.string().optional(),
    default_robots: z.string().default('index,follow'),
    google_site_verification: z.string().optional(),
    analytics_id: z.string().optional(),
    comments_enabled: z.boolean().default(false),
    registration_enabled: z.boolean().default(false),
    maintenance_mode: z.boolean().default(false),
    custom_head_scripts: z.string().optional(),
    custom_body_scripts: z.string().optional(),
    social_links: z.record(z.string(), z.unknown()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type SiteSettingsFixture = z.infer<typeof SiteSettingsFixtureSchema>;

// ─── aggregate parsed payload ─────────────────────────────────────────────

export interface ParsedFixtures {
  media: MediaFixture[];
  contentTypes: ContentTypeFixture[];
  taxonomies: TaxonomyFixture[];
  posts: PostFixture[];
  pages: PageFixture[];
  pageTemplates: PageTemplateFixture[];
  menus: MenuFixture[];
  redirects: RedirectFixture[];
  siteSettings: SiteSettingsFixture | null;
  // Absolute path to <fixturesDir>/media/. Passed through so seed-media can
  // locate source files. May be missing if media.json is absent — the seeder
  // skips the phase in that case.
  mediaSourceDir: string;
}
