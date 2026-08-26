import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';

// Cross-table slug-collision guard for the flat-URL world.
//
// Decode-style URLs put static pages, category archives and tag archives
// all at the publication root (/about, /young-minds, /digital-rights). A
// slug therefore can't be reused across kinds — if `young-minds` already
// exists as a category, no editor can create a page (or a tag) with the
// same slug, or `/young-minds` becomes ambiguous and the resolver in
// routes/public/resolve.ts has to pick a winner.
//
// Called from:
//   * routes/admin/pages.ts POST/PATCH       — page being created/updated
//   * routes/admin/taxonomies.ts term POST/PATCH — term being created/updated
//   * services/fixture-loader/validate.ts    — cross-fixture pre-insert check
//
// Returns the kind that collides, or null if the slug is free. Callers
// translate the kind into a user-facing 400 with code: 'slug_collision'.

export type CollidingKind = 'page' | 'category' | 'tag';

interface CheckArgs {
  slug: string;
  tenantId: string;
  // When updating an existing row, pass its kind + id so the row doesn't
  // collide with itself (e.g. PATCHing /pages/X with the same slug it
  // already has).
  exclude?: {
    kind: CollidingKind;
    id: string;
  };
}

/**
 * Resolve a single slug against (pages, category terms, tag terms) within a
 * tenant and report which kind of row already owns it. Page lookups skip
 * soft-deleted rows. Term lookups join taxonomy.slug so a tag and a category
 * sharing a slug across taxonomies (rare but possible historically) both
 * surface.
 */
export async function findSlugCollision(
  args: CheckArgs,
): Promise<CollidingKind | null> {
  const { slug, tenantId, exclude } = args;

  // 1) Page collision (skip the page being updated, if any).
  const pageWhere =
    exclude?.kind === 'page'
      ? and(
          eq(schema.pages.tenantId, tenantId),
          eq(schema.pages.slug, slug),
          isNull(schema.pages.deletedAt),
          ne(schema.pages.id, exclude.id),
        )
      : and(
          eq(schema.pages.tenantId, tenantId),
          eq(schema.pages.slug, slug),
          isNull(schema.pages.deletedAt),
        );
  const [pageRow] = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(pageWhere)
    .limit(1);
  if (pageRow) return 'page';

  // 2) Category-taxonomy term collision (skip the term being updated).
  const categoryWhere =
    exclude?.kind === 'category'
      ? and(
          eq(schema.taxonomies.tenantId, tenantId),
          eq(schema.taxonomies.slug, 'categories'),
          eq(schema.taxonomyTerms.slug, slug),
          ne(schema.taxonomyTerms.id, exclude.id),
        )
      : and(
          eq(schema.taxonomies.tenantId, tenantId),
          eq(schema.taxonomies.slug, 'categories'),
          eq(schema.taxonomyTerms.slug, slug),
        );
  const [categoryRow] = await db
    .select({ id: schema.taxonomyTerms.id })
    .from(schema.taxonomyTerms)
    .innerJoin(
      schema.taxonomies,
      eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
    )
    .where(categoryWhere)
    .limit(1);
  if (categoryRow) return 'category';

  // 3) Tag-taxonomy term collision.
  const tagWhere =
    exclude?.kind === 'tag'
      ? and(
          eq(schema.taxonomies.tenantId, tenantId),
          eq(schema.taxonomies.slug, 'tags'),
          eq(schema.taxonomyTerms.slug, slug),
          ne(schema.taxonomyTerms.id, exclude.id),
        )
      : and(
          eq(schema.taxonomies.tenantId, tenantId),
          eq(schema.taxonomies.slug, 'tags'),
          eq(schema.taxonomyTerms.slug, slug),
        );
  const [tagRow] = await db
    .select({ id: schema.taxonomyTerms.id })
    .from(schema.taxonomyTerms)
    .innerJoin(
      schema.taxonomies,
      eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
    )
    .where(tagWhere)
    .limit(1);
  if (tagRow) return 'tag';

  return null;
}

/**
 * Format the collision into a 400-response payload mirroring the shape used
 * by isReservedSlug / isReservedContentTypeSlug call sites (code +
 * human-readable message). Keeps every call site terse.
 */
export function collisionResponse(
  slug: string,
  collidesWith: CollidingKind,
): { error: string; code: 'slug_collision'; collidesWith: CollidingKind } {
  const kindLabel =
    collidesWith === 'page'
      ? 'a static page'
      : collidesWith === 'category'
        ? 'a category'
        : 'a tag';
  return {
    error: `Slug "${slug}" is already in use by ${kindLabel}. Pages, categories and tags share the publication root, so each slug can only belong to one of them.`,
    code: 'slug_collision',
    collidesWith,
  };
}

// Suppress the dummy-runtime-use that some tsconfigs flag for sql template
// helpers we import. (Kept import to leave the door open for raw SQL paths
// later — admin slug-collision checks may need it if we add EXISTS folding.)
void sql;
