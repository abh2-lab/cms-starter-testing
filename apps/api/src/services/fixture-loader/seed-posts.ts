import { and, eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { SlugResolver } from './resolve.js';
import type { PostFixture } from './schemas.js';

// Policy: content-editor-owned. We insert on first run, then leave the row
// alone forever — re-runs with a changed fixture do NOT overwrite editor
// changes to title/body/status. Dependent rows (content_seo, taxonomy links)
// are only written when the parent content row was newly inserted in this
// run, mirroring [sample-data.ts:471-482].

export async function seedPosts(args: {
  tenantId: string;
  fixtures: PostFixture[];
  resolver: SlugResolver;
}): Promise<{ posts: number; postSeo: number; postTermLinks: number }> {
  let posts = 0;
  let postSeo = 0;
  let postTermLinks = 0;

  for (const fixture of args.fixtures) {
    const contentTypeId = args.resolver.contentType(fixture.content_type_slug);

    // Pre-resolve `{$media: "..."}` sentinels anywhere inside custom_fields.
    // After this call, the JSONB payload contains only storage_key strings
    // that the public renderer turns into URLs via objectUrl().
    const resolvedCustomFields = args.resolver.resolveSentinels(
      fixture.custom_fields,
    ) as Record<string, unknown>;

    const insertResult = await db
      .insert(schema.content)
      .values({
        tenantId: args.tenantId,
        contentTypeId,
        title: fixture.title,
        slug: fixture.slug,
        status: fixture.status,
        featured: fixture.featured,
        sortOrder: fixture.sort_order,
        locale: fixture.locale,
        customFields: resolvedCustomFields,
        ...(fixture.publish_at !== undefined && fixture.publish_at !== null
          ? { publishAt: new Date(fixture.publish_at) }
          : {}),
        ...(fixture.published_at !== undefined && fixture.published_at !== null
          ? { publishedAt: new Date(fixture.published_at) }
          : {}),
      })
      .onConflictDoNothing({
        target: [
          schema.content.tenantId,
          schema.content.contentTypeId,
          schema.content.slug,
        ],
      })
      .returning({ id: schema.content.id });

    if (insertResult.length === 0) {
      // Pre-existing — editor-owned. Still resolve its id for menu refs.
      // (We don't have a where(eq tenant + type + slug) helper here, so do
      // a small select.)
      const found = await findContent(args.tenantId, contentTypeId, fixture.slug);
      if (found) args.resolver.primeContent(fixture.content_type_slug, fixture.slug, found);
      continue;
    }

    posts += 1;
    const contentId = insertResult[0]!.id;
    args.resolver.primeContent(fixture.content_type_slug, fixture.slug, contentId);

    // ─── content_seo (insert only, no conflict possible) ────────────────
    if (fixture.seo !== undefined) {
      // og_image_key may be a `{$media: "..."}` sentinel — resolve it.
      const ogImageKey =
        fixture.seo.og_image_key === undefined
          ? undefined
          : (args.resolver.resolveSentinels(fixture.seo.og_image_key) as string);
      await db.insert(schema.contentSeo).values({
        tenantId: args.tenantId,
        contentId,
        ...(fixture.seo.meta_title !== undefined
          ? { metaTitle: fixture.seo.meta_title }
          : {}),
        ...(fixture.seo.meta_description !== undefined
          ? { metaDescription: fixture.seo.meta_description }
          : {}),
        ...(fixture.seo.meta_keywords !== undefined
          ? { metaKeywords: fixture.seo.meta_keywords }
          : {}),
        ...(fixture.seo.og_title !== undefined
          ? { ogTitle: fixture.seo.og_title }
          : {}),
        ...(fixture.seo.og_description !== undefined
          ? { ogDescription: fixture.seo.og_description }
          : {}),
        ...(ogImageKey !== undefined ? { ogImageKey } : {}),
        ...(fixture.seo.canonical_url !== undefined
          ? { canonicalUrl: fixture.seo.canonical_url }
          : {}),
        ...(fixture.seo.robots_index !== undefined
          ? { robotsIndex: fixture.seo.robots_index }
          : {}),
        ...(fixture.seo.robots_follow !== undefined
          ? { robotsFollow: fixture.seo.robots_follow }
          : {}),
        ...(fixture.seo.schema_type !== undefined
          ? { schemaType: fixture.seo.schema_type }
          : {}),
      });
      postSeo += 1;
    }

    // ─── content_taxonomy_terms (junction; safe to re-insert) ──────────
    if (fixture.taxonomy_terms.length > 0) {
      const rows = fixture.taxonomy_terms.map((ref) => ({
        contentId,
        termId: args.resolver.term(ref.taxonomy_slug, ref.term_slug),
      }));
      const linkResult = await db
        .insert(schema.contentTaxonomyTerms)
        .values(rows)
        .onConflictDoNothing({
          target: [
            schema.contentTaxonomyTerms.contentId,
            schema.contentTaxonomyTerms.termId,
          ],
        })
        .returning({ contentId: schema.contentTaxonomyTerms.contentId });
      postTermLinks += linkResult.length;
    }
  }

  return { posts, postSeo, postTermLinks };
}

async function findContent(
  tenantId: string,
  contentTypeId: string,
  slug: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.tenantId, tenantId),
        eq(schema.content.contentTypeId, contentTypeId),
        eq(schema.content.slug, slug),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}
