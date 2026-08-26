import { z } from 'zod';

// The block + template contract that backs dynamic Pages.
//
// Architecture rule of thumb: this package is the SERVER-side half. It exports
// metadata (so the admin can render editors against known schemas) and pure
// `load(ctx, …)` functions (so the API can resolve block data parallel-safely).
// The matching Vue render components live in apps/web/app/components/blocks/
// — the public render path imports both: `@cms/blocks` for the registry of
// loaders and `~/components/blocks/<key>.vue` for the visual components.
//
// Blocks deliberately do NOT import @cms/db. The composer endpoint hands them
// a small `ctx` object with the data-fetching helpers they need. That keeps
// blocks portable (the same loader could run in a worker, a CLI, a test) and
// keeps this package zero-dep on Postgres / Meili.

// ─── Field schema for editable inputs ─────────────────────────────────────

// Narrower than content-type field definitions — blocks only need primitive
// inputs (text/number/boolean/select/url + a tiny key-value repeater for the
// impact-stats case), plus media references. The admin's BlockFieldsForm
// renders these.
export const BLOCK_FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'boolean',
  'url',
  'select',
  'content_slug',       // a content row's slug — admin picks from a content list
  'content_type_slug',  // a content type's slug — admin picks from the live
                        //   content-type registry; replaces hand-typed slugs
                        //   on the content_type binding fields (hero, etc.)
  'category_slug',      // a taxonomy term slug — admin picks from a taxonomy
  'custom_field',       // a custom-field KEY from the ancestor box's content
                        //   type — admin picks from that type's field list;
                        //   the renderer formats by the field's declared type
  'kv_list',            // [{label, value}, ...] for impact-stats and similar
  'media_single',       // a media row id — admin picks one from the media
                        //   library. Store the ID, never a URL: object URLs are
                        //   presigned and expire (S3_PUBLIC_URL is unset), so a
                        //   stored URL would rot. Resolve in load() via
                        //   ctx.resolveMediaUrl() to re-sign on every render.
  'media_gallery',      // media row ids (string[]) — same, but multi-select.
] as const;

export const BlockFieldTypeSchema = z.enum(BLOCK_FIELD_TYPES);
export type BlockFieldType = z.infer<typeof BlockFieldTypeSchema>;

export const BlockFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier'),
  label: z.string().min(1),
  type: BlockFieldTypeSchema,
  required: z.boolean().optional(),
  helpText: z.string().optional(),
  default: z.unknown().optional(),
  // select-specific
  options: z.array(z.string()).optional(),
  // content_slug / category_slug — restrict the picker to one type
  contentTypeSlug: z.string().optional(),
  taxonomySlug: z.string().optional(),
  // number-specific
  min: z.number().optional(),
  max: z.number().optional(),
});

export type BlockField = z.infer<typeof BlockFieldSchema>;

// ─── Block metadata + loader contract ─────────────────────────────────────

// Block "kind" — the FSE-style role of a block in a tree. Optional for
// backward-compat: the existing self-sufficient blocks omit it and default to
// 'standalone' (they bring their own data/box and have no children). The
// server composer (apps/api/src/lib/compose-blocks.ts) branches on this.
//   standalone — brings its own box via load(); no children. (the original 9)
//   field      — STYLE-UNAWARE; load() projects from ctx.box into data.
//   container  — styling + children; passes the box through unchanged.
//   box        — sets the current post for descendants via resolveBoxes()
//                (single → 1 box; query-loop → N boxes).
export const BLOCK_KINDS = ['standalone', 'field', 'container', 'box'] as const;
export const BlockKindSchema = z.enum(BLOCK_KINDS);
export type BlockKind = z.infer<typeof BlockKindSchema>;

export const BlockMetaSchema = z.object({
  // Stable lowercase-dashed identifier. Used as the block_key on saved pages
  // and as the lookup key in the Vue registry — keep them aligned.
  key: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'must be a lowercase-dashed identifier'),
  label: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  // A name in the admin's shared Icon set, used in the block picker.
  icon: z.string().optional(),
  // FSE-style role; absent ⇒ 'standalone' (see BLOCK_KINDS). The composer
  // applies the default, so existing block metas need no change.
  kind: BlockKindSchema.optional(),
  // User-editable copy fields (titles, eyebrows, etc.) — fully overridable
  // on a per-page basis.
  fields: z.array(BlockFieldSchema),
  // Data-binding controls (which category feeds this list, which story is
  // featured, etc.) — separated from fields so the admin UI can present them
  // distinctly ("Content" vs "Settings").
  options: z.array(BlockFieldSchema),
});

export type BlockMeta = z.infer<typeof BlockMetaSchema>;

// What a block's `load()` function returns. Always an object so the public
// composer can splat it into the response without coercion; null means
// "this block intentionally has no data to render".
export type BlockData = Record<string, unknown> | null;

// Data-access surface a block loader uses. The composer endpoint implements
// these against the live DB; tests and the docs generator can stub them.
//
// fetchContent — single published content row by (typeSlug, slug). Returns
// null when the row is absent / unpublished / outside the publish window.
//
// fetchArchive — paginated published-content listing. Mirrors the public
// /archive endpoint's shape so blocks and ad-hoc archive routes return the
// same payload to the renderer.
export interface BlockContentSummary {
  id: string;
  title: string;
  slug: string;
  type: string;
  publishedAt: string | null;
  // authors shape mirrors what pickAuthors() emits in apps/api/src/lib/
  // pick-author.ts: prefer the full custom_fields.authors[] array (each
  // entry → /author/<slug>), fall back to a single-element array with the
  // admin user's displayName. slug is null on entries that came from the
  // fallback path. null when neither source has a name.
  authors: { displayName: string; slug: string | null }[] | null;
  heroImageUrl: string | null;
  excerpt: string | null;
  featured: boolean;
  taxonomy: Array<{
    termSlug: string;
    termName: string;
    taxonomySlug: string;
  }>;
}

export interface BlockContentDetail extends BlockContentSummary {
  customFields: Record<string, unknown>;
  seo: {
    metaTitle: string | null;
    metaDescription: string | null;
    ogImageUrl: string | null;
  } | null;
}

// ─── Render context: the "box" (current post) + archive context ───────────
//
// The "box" is the current post a FIELD block reads from — WordPress's "the
// loop" item. It is set by BOX blocks for their descendants and is undefined
// at a template root. Discriminated so a query-loop's lean archive rows are
// typed apart from a single post's full detail:
//   - 'detail'  — a single-post box (e.g. the `single` article template). The
//                 full BlockContentDetail (customFields incl. body, seo) is in
//                 hand, so post-content renders with no extra query.
//   - 'summary' — a query-loop item. Only the lean summary is loaded; a field
//                 block that needs detail (post-content, authors[]) calls
//                 hydrate() to fetch THIS row's detail on demand (the composer
//                 caps how many hydrate per request). Summary-only fields
//                 (title/image/date) never trigger it.
// `content` is present on BOTH variants so summary-only field blocks read
// box.content.X without a kind check.
export type PostBox =
  | {
      kind: 'detail';
      content: BlockContentSummary;
      detail: BlockContentDetail;
      index: number;
      total: number;
    }
  | {
      kind: 'summary';
      content: BlockContentSummary;
      index: number;
      total: number;
      hydrate?: () => Promise<BlockContentDetail | null>;
    };

// Set on archive templates so the archive-title field block (and similar) can
// render the term being browsed without a post box.
export interface ArchiveContext {
  title: string;
  termSlug?: string;
  taxonomySlug?: string;
  description?: string | null;
  // The owning taxonomy's description (e.g. the "Categories" taxonomy blurb).
  // The category manifesto block renders it as a sub-line when present.
  taxonomyDescription?: string | null;
  // Total published rows for the browsed term — the FULL count, not the page
  // the loop composed. The tag hero renders "N Stories" from this.
  total?: number;
}

export interface BlockLoadContext {
  tenantId: string;
  locale: string;
  fetchContent(
    typeSlug: string,
    slug: string,
  ): Promise<BlockContentDetail | null>;
  fetchArchive(opts: {
    typeSlug: string;
    category?: string;
    // Scope the `category` term match to ONE taxonomy (by slug). Without it a
    // term slug matches across ALL taxonomies — right for explicit category
    // pickers, wrong for tag archives where a tag and a category can share a
    // slug. Box blocks pass the ambient archive's taxonomySlug here.
    taxonomy?: string;
    // An independent tag-term match, always scoped to the 'tags' taxonomy.
    // ANDed with `category` when both are set; omit to ignore.
    tag?: string;
    count: number;
  }): Promise<BlockContentSummary[]>;
  // NEW (theme engine v1). The current-post box, set by box blocks for their
  // descendants; undefined/null at a template root. Field blocks read it.
  box?: PostBox | null;
  // NEW. The archive term being rendered (category/tag), set on archive
  // templates; null elsewhere.
  archive?: ArchiveContext | null;
  // Look up a content type's custom-field definition (type + label) by key, so
  // a generic field block can format an arbitrary custom field correctly.
  // Optional — only the live API context provides it; stubs/tests may omit it.
  contentTypeField?(
    typeSlug: string,
    fieldKey: string,
  ): Promise<{ type: string; label: string } | null>;
  // Resolve a media reference (id / storage key / ref object) to a public URL.
  // Used by field blocks rendering media custom fields. Optional, as above.
  resolveMediaUrl?(ref: unknown): Promise<string | null>;
}

// The full block definition — `meta` + a pure loader. Loaders must be
// idempotent and side-effect-free; the public route caches the composed
// page response so a re-run produces the same payload.
export interface Block<F = Record<string, unknown>, O = Record<string, unknown>> {
  meta: BlockMeta;
  load: (
    ctx: BlockLoadContext,
    args: { fields: F; options: O },
  ) => Promise<BlockData>;
  // BOX blocks only (meta.kind === 'box'): resolve the current-post box(es) for
  // descendants. Returns 1 box for a single selector, N for a query-loop. The
  // composer reads this ONLY after a kind === 'box' check, so non-box blocks
  // safely omit it. `load` stays REQUIRED (container/box supply a trivial
  // `async () => null`) so direct callers like the block-preview route
  // (apps/api/src/routes/public/blocks.ts) never hit an undefined method.
  resolveBoxes?: (
    ctx: BlockLoadContext,
    args: { fields: F; options: O },
  ) => Promise<PostBox[]>;
}

// ─── Templates ────────────────────────────────────────────────────────────
//
// Templates are dev-shipped (per the approved plan) — the admin browses + applies,
// but cannot create. Applying a template SNAPSHOTS its block list into the
// page row's `blocks` jsonb so subsequent template edits don't retroactively
// mutate published pages.

// A template block can hold child blocks (InnerBlocks) for container/box
// nesting. `children` is recursive and optional — absent ⇒ a leaf, so existing
// flat templates are unchanged. Inside a BOX block, `children` is the per-item
// template the composer expands once per resolved box. Typed explicitly (not
// z.infer) because the schema references itself via z.lazy; the `unknown` input
// param sidesteps the .default() input-variance friction on a recursive schema.
export type TemplateBlock = {
  block_key: string;
  default_fields: Record<string, unknown>;
  default_options: Record<string, unknown>;
  // `| undefined` matches zod's .optional() output under exactOptionalPropertyTypes.
  children?: TemplateBlock[] | undefined;
};

export const TemplateBlockSchema: z.ZodType<TemplateBlock, z.ZodTypeDef, unknown> =
  z.object({
    block_key: z.string(),
    // Defaults pre-filled into the page when the template is applied.
    default_fields: z.record(z.string(), z.unknown()).default({}),
    default_options: z.record(z.string(), z.unknown()).default({}),
    children: z.lazy(() => z.array(TemplateBlockSchema)).optional(),
  });

// A template's role in the template hierarchy. Template SELECTION (see
// resolveTemplate) keys off this — ALL "by category/type" conditions live in
// selection, never inside blocks or templates. v1 renders `single` (articles)
// and authors `archive`; home/page render from stored page blocks; search/404
// and the header/footer PARTS are reserved for later (the theme keeps its own
// layout for chrome in v1).
export const TEMPLATE_ROLES = [
  'single',
  'archive',
  'home',
  'page',
  'search',
  '404',
  // System-page roles (theme engine v2 Phase 4) — the authors index and the
  // contact page, made override-backed like search/404 so admins can edit them.
  'authors',
  'contact',
  'header',
  'footer',
  // Part role for view-level side columns (e.g. the article sidebar).
  'sidebar',
] as const;
export const TemplateRoleSchema = z.enum(TEMPLATE_ROLES);
export type TemplateRole = z.infer<typeof TemplateRoleSchema>;

export const TemplateMetaSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'must be a lowercase-dashed identifier'),
  name: z.string().min(1),
  description: z.string().optional(),
  previewImage: z.string().optional(),
  // Optional for backward-compat: the existing page templates omit it. Set on
  // the engine templates so resolveTemplate / getTemplatesByRole can find them.
  role: TemplateRoleSchema.optional(),
  // Manual STRUCTURAL version for the override model (theme engine v2.0):
  // bump when a code template/part's block structure changes, so installs
  // with a customized override (stored with the base_version it was authored
  // against) surface an "update available" badge. Absent ⇒ 1.
  version: z.number().int().min(1).optional(),
  blocks: z.array(TemplateBlockSchema),
});

export type TemplateMeta = z.infer<typeof TemplateMetaSchema>;

// ─── Per-page block instance (the shape stored in pages.blocks jsonb) ─────

// `children` makes the stored block list a TREE (container/box nesting). It is
// recursive and optional, so existing FLAT pages.blocks rows (no children) stay
// valid unchanged — no DB migration. The runtime hot path coerces this with a
// hand-rolled walker (see coerceBlockList in apps/api/src/routes/public/
// pages.ts); this schema backs admin-write validation. Typed explicitly (not
// z.infer) for the self-referential z.lazy; `unknown` input sidesteps the
// .default() input-variance friction on a recursive schema.
export type PageBlockInstance = {
  // Per-instance UUID. Lets the admin editor target a specific row when the
  // same block_key appears twice on one page (e.g. two LatestNews lists).
  id: string;
  block_key: string;
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  // `| undefined` matches zod's .optional() output under exactOptionalPropertyTypes.
  children?: PageBlockInstance[] | undefined;
};

export const PageBlockInstanceSchema: z.ZodType<
  PageBlockInstance,
  z.ZodTypeDef,
  unknown
> = z.object({
  id: z.string(),
  block_key: z.string(),
  fields: z.record(z.string(), z.unknown()).default({}),
  options: z.record(z.string(), z.unknown()).default({}),
  children: z.lazy(() => z.array(PageBlockInstanceSchema)).optional(),
});
