import type { FastifyPluginAsync } from 'fastify';
import { and, eq, gt, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { objectUrl } from '../../lib/s3.js';
import { resolveMediaRefUrl } from '../../lib/resolve-media-ref.js';
import { resolveBodyMedia } from '../../lib/resolve-body-media.js';
import { pickAuthors } from '../../lib/pick-author.js';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';
import {
  verifyPreviewToken,
  verifyThemePreviewToken,
} from '../../lib/preview-token.js';
import {
  resolveTemplate,
  type BlockContentDetail,
  type BlockLoadContext,
  type PostBox,
} from '@cms/blocks';
import { buildBlockContext } from '../../lib/block-context.js';
import {
  composeBlocks,
  type ComposedBlock,
} from '../../lib/compose-blocks.js';
import { resolveThemeBlocks } from '../../lib/theme-overrides.js';

const SLUG_SEGMENT = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*$/i);

const Params = z.object({ type: SLUG_SEGMENT, slug: SLUG_SEGMENT });

// Preview tokens are base64url payload + '.' + base64url signature. Tokens
// older than the issued TTL are rejected inside verifyPreviewToken, so the
// schema only does the cheap shape check here.
const Query = z.object({
  preview: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .optional(),
  // Theme-preview token (structure-editor drafts, theme engine v2.0) — makes
  // template/part resolution see DRAFT overrides. Independent of `preview`
  // (which unlocks one unpublished content row).
  theme_preview: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .optional(),
});

interface SeoPayload {
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  twitterImageUrl: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  schemaType: string | null;
  // schemaOverrides omitted on purpose — raw, unvalidated jsonb. Re-add in
  // Phase 7 once it's wrapped in Zod validation.
}

interface TaxonomyTermPayload {
  termSlug: string;
  termName: string;
  taxonomySlug: string;
}

interface ContentPayload {
  id: string;
  title: string;
  slug: string;
  type: string;
  publishedAt: string | null;
  // authors is picked by pickAuthors(): prefer the full
  // custom_fields.authors[] array (each entry → /author/<slug>), fall back
  // to a single-element array with the admin user's displayName when no
  // byline is set. slug is null when the fallback path runs. null when
  // neither source has a name.
  authors: { displayName: string; slug: string | null }[] | null;
  customFields: Record<string, unknown>;
  seo: SeoPayload | null;
  taxonomy: TaxonomyTermPayload[];
  // First taxonomy term where taxonomySlug === 'categories' — used by the
  // flat-URL frontend to build canonical /<category>/<article> links from
  // detail data, and as the breadcrumb anchor on the article page. null
  // when the row has no category term (the category-required-on-publish
  // gate from commit 2.1 keeps that rare).
  primaryCategorySlug: string | null;
  // Resolved post-template key: content.template_key (per-post override)
  // ?? content_types.settings.templates.default (per-type default)
  // ?? DEFAULT_POST_TEMPLATE_KEY. Always a string so the renderer maps it to a
  // layout without a null check.
  templateKey: string;
  // The composed `single` template block-tree, rendered with this content as
  // the current-post box. v1 contains the post-content body block; ArticleView
  // renders it in its content column (the same machinery pages render through).
  blocks: ComposedBlock[];
}

/**
 * Anonymous public content detail. Resolves a single published content row by
 * (content_type slug, content slug). Visibility filter: status=published AND
 * publish_at <= now() AND (unpublish_at IS NULL OR unpublish_at > now()).
 *
 * Image keys (seo.ogImageKey, seo.twitterImageKey, customFields.hero_image_key
 * by convention) are resolved to display URLs here. The frontend never sees
 * raw storage keys. The `hero_image_key` customFields name matches the
 * `media_single` field definition declared on content types that opt in,
 * so the admin editor and the public route read the same key.
 */
export const publicContentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:type/:slug',
    {
      schema: {
        tags: ['Content'],
        summary: 'Get a published content item by type and slug',
        description:
          'Returns the full payload — custom fields, SEO, taxonomy terms, resolved image URLs, author — for the given content type slug plus content slug. Visibility window: status is published AND publish_at is null or in the past AND unpublish_at is null or in the future. Returns 404 when the row does not exist or falls outside the window. Cached for 5 minutes; invalidated on admin publish, update, or delete.',
        operationId: 'getContentBySlug',
        response: {
          200: {
            description: 'Published content item',
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  title: { type: 'string' },
                  slug: { type: 'string' },
                  type: {
                    type: 'string',
                    description: 'content_type slug (e.g. "article")',
                  },
                  publishedAt: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                  },
                  authors: {
                    type: 'array',
                    nullable: true,
                    items: {
                      type: 'object',
                      properties: {
                        displayName: { type: 'string' },
                        // null when the byline came from the admin-user
                        // fallback path (no slug to link to). Declared so
                        // fast-json-stringify doesn't strip it mid-flight.
                        slug: { type: 'string', nullable: true },
                      },
                      required: ['displayName', 'slug'],
                    },
                  },
                  customFields: {
                    type: 'object',
                    additionalProperties: true,
                    description:
                      'Per-content-type fields. Shape is governed by content_types.field_definitions. `heroImageUrl` is spliced in when `hero_image_key` was present.',
                  },
                  seo: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      metaTitle: { type: 'string', nullable: true },
                      metaDescription: { type: 'string', nullable: true },
                      ogImageUrl: { type: 'string', nullable: true },
                      twitterImageUrl: { type: 'string', nullable: true },
                      canonicalUrl: { type: 'string', nullable: true },
                      robotsIndex: { type: 'boolean' },
                      robotsFollow: { type: 'boolean' },
                      schemaType: { type: 'string', nullable: true },
                    },
                  },
                  taxonomy: {
                    type: 'array',
                    items: { $ref: 'TaxonomyTerm#' },
                  },
                  // First taxonomy term whose taxonomy slug is 'categories',
                  // or null. Declared so fast-json-stringify doesn't strip it.
                  primaryCategorySlug: {
                    type: 'string',
                    nullable: true,
                  },
                  // Resolved post-template key. Declared + required so
                  // fast-json-stringify keeps it on the wire.
                  templateKey: { type: 'string' },
                  // Composed `single` template tree. Open objects so the nested
                  // (machine-generated) ComposedBlock shape — incl. recursive
                  // `children` and per-block `data` — passes verbatim. The route
                  // already uses additionalProperties:true for customFields;
                  // same escape hatch. Declared + required so it isn't stripped.
                  blocks: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
                  },
                },
                required: [
                  'id',
                  'title',
                  'slug',
                  'type',
                  'customFields',
                  'taxonomy',
                  'primaryCategorySlug',
                  'templateKey',
                  'blocks',
                ],
              },
            },
            required: ['data'],
          },
          400: {
            description: 'Invalid type or slug segment',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          401: {
            description:
              'preview= was supplied but the token is invalid or expired',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          404: {
            description:
              'Content row does not exist, or falls outside the publish window',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
    const parsed = Params.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid path' });
    }
    const queryParsed = Query.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: 'invalid query' });
    }
    const { type, slug } = parsed.data;

    // Resolve preview mode up front so 401 fails fast and the loader below
    // can branch on a single boolean rather than re-verifying.
    let previewContentId: string | null = null;
    if (queryParsed.data.preview) {
      const verified = verifyPreviewToken(queryParsed.data.preview);
      if (!verified) {
        return reply.code(401).send({ error: 'invalid_preview_token' });
      }
      previewContentId = verified.contentId;
    }
    const isPreview = previewContentId !== null;

    // Theme-draft mode: template resolution sees draft overrides. Verified
    // with the theme-scoped verifier — a content preview token is NOT a
    // theme token (mutual rejection by payload shape).
    let themeDraft = false;
    if (queryParsed.data.theme_preview) {
      if (!verifyThemePreviewToken(queryParsed.data.theme_preview)) {
        return reply.code(401).send({ error: 'invalid_theme_preview_token' });
      }
      themeDraft = true;
    }

    const tenantId = await resolvePublicTenantId();

    const loader = async (): Promise<ContentPayload | null> => {
      const conditions: SQL[] = [
        eq(schema.content.tenantId, tenantId),
        eq(schema.contentTypes.slug, type),
        eq(schema.content.slug, slug),
      ];
      // Preview bypasses the published-status + publish-window filters so
      // editors can see drafts/scheduled/archived rows as they will render.
      // The contentId match below stops a token from being reused for
      // sibling slugs in the same tenant.
      if (!isPreview) {
        conditions.push(
          eq(schema.content.status, 'published'),
          // publish_at is NULL for directly-published content (the
          // transitions handler only sets published_at); a non-null
          // publish_at means scheduled, which becomes visible once due.
          or(
            isNull(schema.content.publishAt),
            lte(schema.content.publishAt, sql`now()`),
          )!,
          or(
            isNull(schema.content.unpublishAt),
            gt(schema.content.unpublishAt, sql`now()`),
          )!,
        );
      }

      const [row] = await db
        .select({
          id: schema.content.id,
          title: schema.content.title,
          contentSlug: schema.content.slug,
          contentTypeSlug: schema.contentTypes.slug,
          publishedAt: schema.content.publishedAt,
          featured: schema.content.featured,
          customFields: schema.content.customFields,
          templateKey: schema.content.templateKey,
          contentTypeSettings: schema.contentTypes.settings,
          authorDisplayName: schema.adminUsers.displayName,
          // seoId doubles as the "did the LEFT JOIN match?" sentinel — when
          // null, no contentSeo row exists for this content.
          seoId: schema.contentSeo.id,
          metaTitle: schema.contentSeo.metaTitle,
          metaDescription: schema.contentSeo.metaDescription,
          ogImageKey: schema.contentSeo.ogImageKey,
          twitterImageKey: schema.contentSeo.twitterImageKey,
          canonicalUrl: schema.contentSeo.canonicalUrl,
          robotsIndex: schema.contentSeo.robotsIndex,
          robotsFollow: schema.contentSeo.robotsFollow,
          schemaType: schema.contentSeo.schemaType,
        })
        .from(schema.content)
        .innerJoin(
          schema.contentTypes,
          eq(schema.content.contentTypeId, schema.contentTypes.id),
        )
        .leftJoin(
          schema.contentSeo,
          eq(schema.contentSeo.contentId, schema.content.id),
        )
        .leftJoin(
          schema.adminUsers,
          eq(schema.content.authorId, schema.adminUsers.id),
        )
        .where(and(...conditions))
        .limit(1);

      if (!row) return null;
      // Token-to-content binding: a preview token is only good for the
      // exact content row it was issued for. Guessing another slug in the
      // same tenant with a stolen token must still 404.
      if (previewContentId && row.id !== previewContentId) return null;

      // Taxonomy terms — separate query so the main row doesn't fan out.
      const termRows = await db
        .select({
          termSlug: schema.taxonomyTerms.slug,
          termName: schema.taxonomyTerms.name,
          taxonomySlug: schema.taxonomies.slug,
        })
        .from(schema.contentTaxonomyTerms)
        .innerJoin(
          schema.taxonomyTerms,
          eq(schema.contentTaxonomyTerms.termId, schema.taxonomyTerms.id),
        )
        .innerJoin(
          schema.taxonomies,
          eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
        )
        .where(eq(schema.contentTaxonomyTerms.contentId, row.id));

      // Hero image lives in customFields.hero_image_key by convention.
      // The key matches a content_types.field_definitions entry of type
      // media_single, so the admin editor and the public route read the
      // same key. Other media fields a content type may define are NOT
      // auto-resolved here — they stay as raw keys for the frontend.
      const customFields = (row.customFields ?? {}) as Record<string, unknown>;
      const rawHero = customFields['hero_image_key'];
      const heroImageKey = typeof rawHero === 'string' ? rawHero : null;

      const [ogImageUrl, twitterImageUrl, heroImageUrl] = await Promise.all([
        row.ogImageKey ? objectUrl(row.ogImageKey) : Promise.resolve(null),
        row.twitterImageKey
          ? objectUrl(row.twitterImageKey)
          : Promise.resolve(null),
        // hero_image_key may be a media id (admin picker) or a legacy storage
        // path (seed) — resolveMediaRefUrl handles both.
        heroImageKey
          ? resolveMediaRefUrl(tenantId, heroImageKey)
          : Promise.resolve(null),
      ]);

      // Splice the resolved hero URL alongside its key so the frontend gets
      // it without round-tripping back through objectUrl.
      const enrichedCustomFields = heroImageUrl
        ? { ...customFields, heroImageUrl }
        : customFields;

      // Resolve any inlineImage/gallery mediaIds in the body (and any other
      // rich-text field) to display URLs so the renderer can emit real <img>s.
      // Read-only: the resolved src/images are never persisted.
      const resolvedCustomFields = await resolveBodyMedia(
        enrichedCustomFields,
        tenantId,
      );

      const seo: SeoPayload | null = row.seoId
        ? {
            metaTitle: row.metaTitle,
            metaDescription: row.metaDescription,
            ogImageUrl,
            twitterImageUrl,
            canonicalUrl: row.canonicalUrl,
            robotsIndex: row.robotsIndex ?? true,
            robotsFollow: row.robotsFollow ?? true,
            schemaType: row.schemaType,
          }
        : null;

      const taxonomy = termRows.map((t) => ({
        termSlug: t.termSlug,
        termName: t.termName,
        taxonomySlug: t.taxonomySlug,
      }));
      const primaryCategorySlug =
        termRows.find((t) => t.taxonomySlug === 'categories')?.termSlug ?? null;

      // Resolve the `single` template via the hierarchy (per-post override →
      // per-type default → built-in default). resolveTemplate returns the key
      // (drives ArticleView's CSS variant) AND the block-tree to compose.
      const typeSettings = row.contentTypeSettings as
        | { templates?: { default?: unknown } }
        | null;
      const typeDefaultTemplate =
        typeof typeSettings?.templates?.default === 'string' &&
        typeSettings.templates.default.length > 0
          ? typeSettings.templates.default
          : null;
      const resolved = resolveTemplate({
        role: 'single',
        templateKey: row.templateKey,
        typeDefaultKey: typeDefaultTemplate,
        primaryCategorySlug,
      });
      const resolvedTemplateKey = resolved.key;

      // Build the current-post BOX from the row we already resolved (no extra
      // query) and compose the `single` template around it. The body stays in
      // TipTap — the post-content field block reads it from the box's
      // (media-resolved) customFields.
      const boxDetail: BlockContentDetail = {
        id: row.id,
        title: row.title,
        slug: row.contentSlug,
        type: row.contentTypeSlug,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        authors: pickAuthors(customFields, row.authorDisplayName),
        heroImageUrl,
        excerpt:
          typeof customFields['excerpt'] === 'string'
            ? customFields['excerpt']
            : null,
        featured: row.featured ?? false,
        taxonomy,
        customFields: resolvedCustomFields,
        seo: seo
          ? {
              metaTitle: seo.metaTitle,
              metaDescription: seo.metaDescription,
              ogImageUrl: seo.ogImageUrl,
            }
          : null,
      };
      const box: PostBox = {
        kind: 'detail',
        content: boxDetail,
        detail: boxDetail,
        index: 0,
        total: 1,
      };
      const blockCtx: BlockLoadContext = {
        ...buildBlockContext({ tenantId, locale: 'en' }),
        box,
      };
      // THEME OVERRIDE (v2.0): draft (theme_preview) → published → code
      // default. Keyed on the template's own key ('single-article'), never
      // on the post-template variant key in resolvedTemplateKey.
      const themeBlocks = await resolveThemeBlocks(
        request.log,
        tenantId,
        resolved.template,
        { draft: themeDraft },
      );
      const blocks = await composeBlocks(
        blockCtx,
        themeBlocks.instances,
        request.log,
      );

      return {
        id: row.id,
        title: row.title,
        slug: row.contentSlug,
        type: row.contentTypeSlug,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        authors: pickAuthors(customFields, row.authorDisplayName),
        customFields: resolvedCustomFields,
        seo,
        taxonomy,
        primaryCategorySlug,
        templateKey: resolvedTemplateKey,
        blocks,
      };
    };

    // Bypass the Dragonfly cache for preview reads (content preview AND
    // theme-draft preview) so editors always see the latest draft, and never
    // poison the cached published-shape value.
    const bypassCache = isPreview || themeDraft;
    const payload = bypassCache
      ? await loader()
      : await withCache<ContentPayload | null>(
          `cache:content:${tenantId}:${type}:${slug}`,
          PUBLIC_CACHE_TTL_SECONDS,
          loader,
        );

    if (!payload) return reply.code(404).send({ error: 'not found' });

    if (bypassCache) {
      reply.header('Cache-Control', 'no-store, must-revalidate');
    } else {
      cacheHeaders(reply);
    }
    return { data: payload };
  });
};
