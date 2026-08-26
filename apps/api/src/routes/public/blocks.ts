import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getBlock,
  type ArchiveContext,
  type BlockField,
  type BlockLoadContext,
  type PostBox,
} from '@cms/blocks';
import { resolvePublicTenantId } from '../../lib/public-tenant.js';
import { buildBlockContext } from '../../lib/block-context.js';
import { defaultsFor } from '../../lib/block-defaults.js';
import { verifyThemePreviewToken } from '../../lib/preview-token.js';
import { resolveBlockOverrides } from '../../lib/theme-overrides.js';

// Single-block preview endpoint. Powers the "Preview" button on each library
// card in the dynamic-page builder: the admin opens
// `${siteSettings.siteUrl}/preview/block/:key` in a new tab, the Nuxt route
// fetches this endpoint, and the matching block component renders with
// defaults so the editor can see exactly what they're picking before they
// add it.
//
// Defaults strategy: every BlockField in the schema gets either its `default`
// value or a type-appropriate empty (empty string for text/select/url,
// undefined for number/boolean to let the loader's own fallbacks apply, []
// for kv_list). The block's load() function is then run with these defaults
// against the live public-tenant context — content-bound blocks (Hero,
// Featured Article) typically degrade to the empty-state render because no
// story slug is selected by default, while self-contained blocks (Impact
// Stats) render their full visual.

const Params = z.object({
  key: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z][a-z0-9-]*$/),
});

interface BlockPreviewPayload {
  key: string;
  label: string;
  fields: Record<string, unknown>;
  options: Record<string, unknown>;
  data: Record<string, unknown> | null;
  // 'load_failed' surfaces a loader exception so the public route can show an
  // amber notice; the block still renders with whatever defaults are present.
  error?: 'load_failed';
}

// Defaults derivation moved to ../../lib/block-defaults.ts (defaultsFor) —
// the override normalizer (theme engine v2.0) shares it so the values a
// loader sees here match what normalization fills into stored trees.

// Fill in plausible "demo" values for any binding fields the user would
// normally pick. Without this, blocks like Hero / Featured Article render
// their empty-state placeholder ("no story selected") because the schema's
// slug default is the empty string — that's the wrong message for a preview
// whose whole point is showing the block populated. Walk the option schema:
// for each content_slug field, find the sibling content_type (either via
// field.contentTypeSlug pinning, the resolved `content_type` option, or
// 'article' as a final fallback) and grab the first published row's slug.
//
// When NO published row exists for the chosen type, we leave the slug blank
// and the block still degrades gracefully — the preview page surfaces the
// load_failed / empty-state path so the editor learns "you need real
// content of this type before this block has anything to show".
async function autoResolveBindings(
  fields: BlockField[],
  values: Record<string, unknown>,
  ctx: BlockLoadContext,
): Promise<void> {
  // Resolve content_type for sibling content_slug fields first. If the user-
  // facing default ('article') doesn't exist for this tenant, fall through —
  // the per-field resolver will still try field.contentTypeSlug.
  const resolveSiblingContentType = (f: BlockField): string | null => {
    if (f.contentTypeSlug) return f.contentTypeSlug;
    const sibling = values['content_type'];
    if (typeof sibling === 'string' && sibling.length > 0) return sibling;
    return null;
  };

  for (const f of fields) {
    if (f.type !== 'content_slug') continue;
    const current = values[f.key];
    if (typeof current === 'string' && current.length > 0) continue;
    const typeSlug = resolveSiblingContentType(f);
    if (!typeSlug) continue;
    try {
      const items = await ctx.fetchArchive({ typeSlug, count: 1 });
      const first = items[0];
      if (first) values[f.key] = first.slug;
    } catch {
      // Swallow — preview should never 500 because of a binding autofill miss.
      // The block will degrade to its empty-state render below.
    }
  }
}

// Build a SAMPLE render context for FIELD blocks (theme engine v3 Block
// Gallery): a field block (post-title, featured-image, archive-hero, …)
// projects from the current-post box and/or the archive context, so it only
// renders meaningfully when those are present. We synthesise both from the
// latest published article + its primary category, so most field blocks show
// real content. Returns null when the install has no published article — the
// gallery then shows a clean "No preview" card rather than an empty render.
async function sampleFieldContext(
  ctx: BlockLoadContext,
): Promise<{ box: PostBox; archive: ArchiveContext } | null> {
  const items = await ctx.fetchArchive({ typeSlug: 'article', count: 1 });
  const summary = items[0];
  if (!summary) return null;
  const detail = await ctx.fetchContent('article', summary.slug);
  if (!detail) return null;
  const box: PostBox = {
    kind: 'detail',
    content: detail,
    detail,
    index: 0,
    total: 1,
  };
  const cat = detail.taxonomy.find((t) => t.taxonomySlug === 'categories');
  const archive: ArchiveContext = {
    title: cat?.termName ?? detail.title,
    taxonomySlug: 'categories',
    description: null,
    total: 0,
    ...(cat?.termSlug ? { termSlug: cat.termSlug } : {}),
  };
  return { box, archive };
}

export const publicBlocksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:key/preview', async (request, reply) => {
    const parsed = Params.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_key' });
    }
    const { key } = parsed.data;

    const block = getBlock(key);
    if (!block) {
      return reply.code(404).send({ error: 'unknown_block' });
    }

    // Previewability by kind:
    //   standalone — self-sufficient; render with defaults (+ binding autofill).
    //   field      — projects from a post box / archive; render inside a SAMPLE
    //                context from the latest article (422 when none exists).
    //   container/box — structural (need children / a query template); not
    //                previewable in isolation, so the gallery shows "No preview".
    const kind = block.meta.kind ?? 'standalone';

    const fields = defaultsFor(block.meta.fields);
    const options = defaultsFor(block.meta.options);

    const tenantId = await resolvePublicTenantId();

    // Apply the block's saved default override so the gallery preview reflects
    // it; a valid ?theme_preview shows the DRAFT (the block editor's live
    // preview of unsaved edits). Override values layer OVER the code defaults.
    const previewRaw = (request.query as { theme_preview?: unknown })
      .theme_preview;
    const themeDraft =
      typeof previewRaw === 'string' && verifyThemePreviewToken(previewRaw);
    const blockOverride = (
      await resolveBlockOverrides(request.log, tenantId, { draft: themeDraft })
    ).get(key);
    if (blockOverride) {
      Object.assign(fields, blockOverride.fields);
      Object.assign(options, blockOverride.options);
    }

    const baseCtx = buildBlockContext({ tenantId, locale: 'en' });
    let ctx: BlockLoadContext = baseCtx;

    if (kind === 'field') {
      const sample = await sampleFieldContext(baseCtx).catch((err: unknown) => {
        // Log a real DB failure (matches the load() catch below) instead of
        // silently reporting it as "no sample content" to the gallery.
        request.log.warn(
          { err, block_key: key },
          'block preview: sample-context build failed',
        );
        return null;
      });
      if (!sample) {
        return reply
          .code(422)
          .send({ error: 'not_previewable', kind, reason: 'no_sample_content' });
      }
      ctx = { ...baseCtx, box: sample.box, archive: sample.archive };
    } else if (kind !== 'standalone') {
      return reply.code(422).send({ error: 'not_previewable', kind });
    } else {
      // Standalone: autofill binding fields with the first published row of the
      // matching content type so content-bound blocks (Hero, Featured Article)
      // render real content instead of the empty-state.
      await autoResolveBindings(block.meta.options, options, ctx);
    }

    const payload: BlockPreviewPayload = {
      key: block.meta.key,
      label: block.meta.label,
      fields,
      options,
      data: null,
    };

    try {
      const data = await block.load(ctx, { fields, options });
      payload.data = data ?? null;
    } catch (err) {
      request.log.warn(
        { err, block_key: key },
        'block preview: loader threw — returning degraded payload',
      );
      payload.error = 'load_failed';
    }

    return { data: payload };
  });
};
