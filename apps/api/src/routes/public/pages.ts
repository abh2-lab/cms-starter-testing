import type { FastifyPluginAsync } from 'fastify';
import { and, eq, gt, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import type { PageBlockInstance } from '@cms/blocks';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  cacheHeaders,
  withCache,
} from '../../lib/cache.js';
import { verifyPreviewToken } from '../../lib/preview-token.js';
import { buildBlockContext } from '../../lib/block-context.js';
import { composeBlocks, type ComposedBlock } from '../../lib/compose-blocks.js';
import { withBlockOverrides } from '../../lib/theme-overrides.js';
import { resolveBodyMedia } from '../../lib/resolve-body-media.js';

// Path param: the page slug. Anchored regex matches the SlugSchema in
// admin/pages.ts so we never have to handle weird shapes downstream.
const SLUG_SEGMENT = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const Params = z.object({ slug: SLUG_SEGMENT });

// Preview token shape is the same as content's: `<base64url>.<base64url>`.
// Token expiry is checked inside verifyPreviewToken, so we only do the cheap
// regex here.
const Query = z.object({
  preview: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .optional(),
});

interface PageSeoPayload {
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
}

interface PagePayload {
  id: string;
  title: string;
  slug: string;
  type: 'static' | 'dynamic';
  publishedAt: string | null;
  seo: PageSeoPayload;
  // Static branch. Raw HTML + CSS — the render path injects css inside a
  // <style> tag and html via v-html (Raw mode).
  html: string | null;
  css: string | null;
  // Static branch. Which layout shell renders the page, and how its body is
  // authored. `body` carries the TipTap JSON in Normal mode (null in Raw and on
  // dynamic rows). The renderer picks html/css vs body off `contentMode`.
  layoutTemplate: string | null;
  contentMode: 'normal' | 'raw';
  body: unknown;
  // Dynamic branch. Per-block loader output, ordered as stored on the page
  // row. Empty array for static pages.
  blocks: ComposedBlock[];
}

const DEFAULT_SEO: PageSeoPayload = {
  metaTitle: null,
  metaDescription: null,
  ogImageUrl: null,
  canonicalUrl: null,
  robotsIndex: true,
  robotsFollow: true,
};

// Cast pages.blocks jsonb (typed as `unknown` by drizzle) into the instance
// shape we feed each block loader. Bad rows are skipped rather than rejected
// so a single malformed entry in a long block list doesn't kill the page —
// the editor sees the others render and notices the gap. instance.id is
// generated on the fly when missing so older saves don't break.
function coerceBlockList(raw: unknown): PageBlockInstance[] {
  if (!Array.isArray(raw)) return [];
  const out: PageBlockInstance[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const key = obj['block_key'];
    if (typeof key !== 'string' || key.length === 0) continue;
    const id = typeof obj['id'] === 'string' ? (obj['id']) : key;
    const fields =
      obj['fields'] && typeof obj['fields'] === 'object'
        ? (obj['fields'] as Record<string, unknown>)
        : {};
    const options =
      obj['options'] && typeof obj['options'] === 'object'
        ? (obj['options'] as Record<string, unknown>)
        : {};
    // Recurse nested children (container/box trees). Absent ⇒ leaf; attach
    // `children` only when non-empty so a flat page's instance shape — and
    // therefore its composed output — is unchanged from the pre-nesting era.
    const children = coerceBlockList(obj['children']);
    const inst: PageBlockInstance = { id, block_key: key, fields, options };
    if (children.length) inst.children = children;
    out.push(inst);
  }
  return out;
}

function mergeSeo(rawSeo: unknown): PageSeoPayload {
  if (!rawSeo || typeof rawSeo !== 'object') return { ...DEFAULT_SEO };
  const obj = rawSeo as Record<string, unknown>;
  const pick = (k: string): string | null => {
    const v = obj[k];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const flag = (k: string, fallback: boolean): boolean => {
    const v = obj[k];
    return typeof v === 'boolean' ? v : fallback;
  };
  return {
    metaTitle: pick('metaTitle'),
    metaDescription: pick('metaDescription'),
    ogImageUrl: pick('ogImageUrl'),
    canonicalUrl: pick('canonicalUrl'),
    robotsIndex: flag('robotsIndex', true),
    robotsFollow: flag('robotsFollow', true),
  };
}

/**
 * Anonymous public page detail. Resolves a single published page row by slug.
 * Visibility filter: status=published AND publish_at IS NULL OR <= now() AND
 * (unpublish_at IS NULL OR unpublish_at > now()).
 *
 * Static pages return `{type:'static', html, css, ...}`. Dynamic pages run
 * the shared composer (lib/compose-blocks.ts): each block's loader runs in
 * parallel with per-block error isolation, nested children/box trees are
 * walked recursively, and the response carries
 * `blocks: [{ key, fields, options, data, children? }]`.
 *
 * `?preview=<token>` bypasses the visibility filter AND the cache so editors
 * see drafts as they will render. The token must have been issued for the
 * exact page id; a stolen token cannot be reused for a sibling slug.
 */
export const publicPagesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:slug', async (request, reply) => {
    const parsed = Params.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid path' });
    }
    const queryParsed = Query.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: 'invalid query' });
    }
    const { slug } = parsed.data;

    // Resolve preview mode up front so 401 fails fast.
    let previewPageId: string | null = null;
    if (queryParsed.data.preview) {
      const verified = verifyPreviewToken(queryParsed.data.preview);
      if (!verified) {
        return reply.code(401).send({ error: 'invalid_preview_token' });
      }
      // generatePreviewToken stores the resource id as `contentId`; for pages
      // we treat it polymorphically — the token is issued by the pages route
      // with the page id, and we match that here.
      previewPageId = verified.contentId;
    }
    const isPreview = previewPageId !== null;

    const tenantId = await resolvePublicTenantId();

    const loader = async (): Promise<PagePayload | null> => {
      const conditions: SQL[] = [
        eq(schema.pages.tenantId, tenantId),
        eq(schema.pages.slug, slug),
        isNull(schema.pages.deletedAt),
      ];
      if (!isPreview) {
        conditions.push(
          eq(schema.pages.status, 'published'),
          or(
            isNull(schema.pages.publishAt),
            lte(schema.pages.publishAt, sql`now()`),
          )!,
          or(
            isNull(schema.pages.unpublishAt),
            gt(schema.pages.unpublishAt, sql`now()`),
          )!,
        );
      }

      const [row] = await db
        .select({
          id: schema.pages.id,
          title: schema.pages.title,
          slug: schema.pages.slug,
          type: schema.pages.type,
          publishedAt: schema.pages.publishedAt,
          seo: schema.pages.seo,
          html: schema.pages.html,
          css: schema.pages.css,
          layoutTemplate: schema.pages.layoutTemplate,
          contentMode: schema.pages.contentMode,
          body: schema.pages.body,
          blocks: schema.pages.blocks,
        })
        .from(schema.pages)
        .where(and(...conditions))
        .limit(1);

      if (!row) return null;
      // Token-to-page binding — a preview token is only good for the exact
      // page id it was issued for. Guessing another slug with a stolen token
      // must still 404.
      if (previewPageId && row.id !== previewPageId) return null;

      // Static pages are served verbatim. The admin-only authoring surface
      // doesn't sanitize, so there's nothing to re-strip here. Note: <script>
      // tags inside row.html will not execute on the client (innerHTML drops
      // them when v-html injects the markup) — that's expected. Tracking
      // scripts belong in the (forthcoming) Extra <head> field.
      let staticHtml: string | null = null;
      let staticCss: string | null = null;
      if (row.type === 'static') {
        staticHtml = row.html ?? '';
        staticCss = row.css ?? '';
      }

      // Dynamic branch — fan out block loaders concurrently. Each loader is
      // wrapped in safeLoad so one bad block (a removed block_key, a thrown
      // exception, a slow DB query that times out) cannot 500 the entire
      // page. The renderer reads the `error` field on each composed block
      // to decide whether to show the slot or a placeholder.
      let composedBlocks: ComposedBlock[] = [];
      if (row.type === 'dynamic') {
        const instances = coerceBlockList(row.blocks);
        const ctx = buildBlockContext({ tenantId, locale: 'en' });
        composedBlocks = await composeBlocks(
          ctx,
          await withBlockOverrides(request.log, tenantId, instances),
          request.log,
        );
      }

      // Normal-mode static pages carry their TipTap body JSON; Raw mode uses
      // html/css. Dynamic rows expose neither (contentMode coerced to 'raw').
      const contentMode = row.contentMode === 'normal' ? 'normal' : 'raw';
      const isNormalStatic = row.type === 'static' && contentMode === 'normal';
      // Inline images / galleries in a TipTap body store only a mediaId — resolve
      // them to signed display URLs here (the same step the article body path
      // runs) so the renderer emits real <img>s. Without this, images inserted in
      // a page's Normal editor don't load on the public site.
      const resolvedBody =
        isNormalStatic && row.body && typeof row.body === 'object'
          ? await resolveBodyMedia(row.body as Record<string, unknown>, tenantId)
          : null;

      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        type: row.type,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        seo: mergeSeo(row.seo),
        html: staticHtml,
        css: staticCss,
        layoutTemplate: row.type === 'static' ? (row.layoutTemplate ?? 'default') : null,
        contentMode,
        body: resolvedBody,
        blocks: composedBlocks,
      };
    };

    // Preview must bypass the cache: editors expect their save to be visible
    // immediately, and we don't want preview content leaking to the next
    // visitor who hits the same slug. The non-preview path goes through
    // withCache, which (post-phase-1) single-flights concurrent misses so a
    // 50-request burst at a freshly-evicted key fans out to ONE DB query.
    const data = isPreview
      ? await loader()
      : await withCache(
          `cache:page:${tenantId}:${slug}`,
          PUBLIC_CACHE_TTL_SECONDS,
          loader,
        );

    if (!data) return reply.code(404).send({ error: 'not_found' });
    // Cached responses carry standard Cache-Control so a CDN can layer on
    // top with the same TTL as our Dragonfly entry.
    if (!isPreview) cacheHeaders(reply);
    return { data };
  });
};
