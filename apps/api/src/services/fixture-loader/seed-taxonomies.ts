import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { SlugResolver } from './resolve.js';
import type { TaxonomyFixture } from './schemas.js';

// Two-pass term insert: first pass writes every term with parent_id null,
// second pass updates parent_id once all sibling ids are resolvable. This
// avoids a topological sort and keeps the code linear.

export async function seedTaxonomies(args: {
  tenantId: string;
  fixtures: TaxonomyFixture[];
  resolver: SlugResolver;
}): Promise<{ taxonomies: number; taxonomyTerms: number }> {
  let insertedTaxonomies = 0;
  let insertedTerms = 0;

  for (const tax of args.fixtures) {
    // ─── taxonomy row ───────────────────────────────────────────────────
    const taxInsert = await db
      .insert(schema.taxonomies)
      .values({
        tenantId: args.tenantId,
        name: tax.name,
        slug: tax.slug,
        ...(tax.description !== undefined
          ? { description: tax.description }
          : {}),
        kind: tax.kind,
        isHierarchical: tax.is_hierarchical,
      })
      .onConflictDoNothing({
        target: [schema.taxonomies.tenantId, schema.taxonomies.slug],
      })
      .returning({
        id: schema.taxonomies.id,
        slug: schema.taxonomies.slug,
      });

    let taxonomyId: string;
    if (taxInsert.length > 0) {
      insertedTaxonomies += 1;
      taxonomyId = taxInsert[0]!.id;
    } else {
      const taxUpdate = await db
        .update(schema.taxonomies)
        .set({
          name: tax.name,
          ...(tax.description !== undefined
            ? { description: tax.description }
            : {}),
          kind: tax.kind,
          isHierarchical: tax.is_hierarchical,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(schema.taxonomies.tenantId, args.tenantId),
            eq(schema.taxonomies.slug, tax.slug),
          ),
        )
        .returning({ id: schema.taxonomies.id });
      if (taxUpdate.length === 0) {
        throw new Error(
          `seed-taxonomies: taxonomy "${tax.slug}" vanished between insert and update`,
        );
      }
      taxonomyId = taxUpdate[0]!.id;
    }
    args.resolver.primeTaxonomy(tax.slug, taxonomyId);

    // ─── terms pass 1: insert/update flat (parent_id null) ──────────────
    for (const term of tax.terms) {
      const termInsert = await db
        .insert(schema.taxonomyTerms)
        .values({
          tenantId: args.tenantId,
          taxonomyId,
          name: term.name,
          slug: term.slug,
          ...(term.description !== undefined
            ? { description: term.description }
            : {}),
          sortOrder: term.sort_order,
        })
        .onConflictDoNothing({
          target: [schema.taxonomyTerms.taxonomyId, schema.taxonomyTerms.slug],
        })
        .returning({
          id: schema.taxonomyTerms.id,
          slug: schema.taxonomyTerms.slug,
        });

      let termId: string;
      if (termInsert.length > 0) {
        insertedTerms += 1;
        termId = termInsert[0]!.id;
      } else {
        const termUpdate = await db
          .update(schema.taxonomyTerms)
          .set({
            name: term.name,
            ...(term.description !== undefined
              ? { description: term.description }
              : {}),
            sortOrder: term.sort_order,
            updatedAt: sql`NOW()`,
          })
          .where(
            and(
              eq(schema.taxonomyTerms.taxonomyId, taxonomyId),
              eq(schema.taxonomyTerms.slug, term.slug),
            ),
          )
          .returning({ id: schema.taxonomyTerms.id });
        if (termUpdate.length === 0) {
          throw new Error(
            `seed-taxonomies: term "${term.slug}" vanished between insert and update`,
          );
        }
        termId = termUpdate[0]!.id;
      }
      args.resolver.primeTerm(tax.slug, term.slug, termId);
    }

    // ─── terms pass 2: resolve parent_slug → parent_id ──────────────────
    for (const term of tax.terms) {
      if (term.parent_slug === undefined) continue;
      const termId = args.resolver.term(tax.slug, term.slug);
      const parentId = args.resolver.term(tax.slug, term.parent_slug);
      await db
        .update(schema.taxonomyTerms)
        .set({ parentId, updatedAt: sql`NOW()` })
        .where(eq(schema.taxonomyTerms.id, termId));
    }
  }

  return { taxonomies: insertedTaxonomies, taxonomyTerms: insertedTerms };
}
