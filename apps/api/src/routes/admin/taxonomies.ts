import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { SQL } from 'drizzle-orm';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { logAudit } from '../../lib/audit.js';
import {
  collisionResponse,
  findSlugCollision,
} from '../../lib/slug-collision.js';
import {
  decodeNameIdCursor,
  encodeNameIdCursor,
} from '../../lib/pagination.js';

// ─── Validation schemas ────────────────────────────────────────────────────

const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-z][a-z0-9-]*$/,
    'must be lowercase alphanumeric + hyphens, starting with a letter',
  );

const NameSchema = z.string().min(1).max(100);

const TaxonomyIdParam = z.object({ id: z.string().uuid() });
const TaxonomyScopeParam = z.object({ taxonomyId: z.string().uuid() });
const TermScopeParam = z.object({
  taxonomyId: z.string().uuid(),
  termId: z.string().uuid(),
});

const TaxonomyKindSchema = z.enum(['category', 'tag']);

// kind defaults to 'category' to match the schema default — every flat
// taxonomy used to slip through as "tag" via the isHierarchical heuristic;
// callers must now be explicit when they want a tag. The cross-field rule
// (tag MUST NOT be hierarchical) is enforced after parsing in the handler.
const CreateTaxonomyBody = z
  .object({
    name: NameSchema,
    slug: SlugSchema,
    kind: TaxonomyKindSchema.optional().default('category'),
    isHierarchical: z.boolean().optional().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.kind === 'tag' && val.isHierarchical) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isHierarchical'],
        message: 'Tags cannot be hierarchical; set kind to "category" first.',
      });
    }
  });
const UpdateTaxonomyBody = z
  .object({
    name: NameSchema.optional(),
    slug: SlugSchema.optional(),
    kind: TaxonomyKindSchema.optional(),
    isHierarchical: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    // Only assert the rule when both fields are present in the patch; the
    // handler does a second check post-merge against the stored row so an
    // update that flips only kind doesn't bypass the constraint.
    if (val.kind === 'tag' && val.isHierarchical === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isHierarchical'],
        message: 'Tags cannot be hierarchical.',
      });
    }
  });

const CreateTermBody = z.object({
  name: NameSchema,
  slug: SlugSchema,
  description: z.string().max(500).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
});
const UpdateTermBody = CreateTermBody.partial();

const ListQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// Both taxonomy and term tenant filters now route through the shared
// tenantFilter helper in ../../lib/tenant-scope.ts so super_admin bypasses
// scoping automatically.

function isTaxonomyUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Error && e.message.includes('taxonomies_tenant_slug_uniq')
  );
}

function isTermUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Error &&
    e.message.includes('taxonomy_terms_taxonomy_slug_uniq')
  );
}

// Load a taxonomy belonging to the caller's tenant, or null. Term handlers
// need the row (specifically `kind`) to reject parentId on tag-kind
// taxonomies, so this returns the row instead of a boolean.
async function findTaxonomyInTenant(
  taxonomyId: string,
  session: { role: string; tenantId: string | null },
): Promise<{ id: string; kind: 'category' | 'tag'; slug: string } | null> {
  const [row] = await db
    .select({
      id: schema.taxonomies.id,
      kind: schema.taxonomies.kind,
      // slug is needed by the flat-URL slug-collision guard to know
      // whether this taxonomy's terms become root URLs (only 'categories'
      // and 'tags' do; custom taxonomies don't share the publication root).
      slug: schema.taxonomies.slug,
    })
    .from(schema.taxonomies)
    .where(
      and(
        eq(schema.taxonomies.id, taxonomyId),
        tenantFilter(session, schema.taxonomies.tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const adminTaxonomiesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // ─── Taxonomies (top-level) ─────────────────────────────────────────────

  // Alphabetical by name; (name, id) tuple cursor keeps ordering stable across
  // pages even when two taxonomies share a name within a tenant.
  fastify.get('/', async (request, reply) => {
    const query = ListQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        error: 'Invalid query',
        issues: query.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const session = getSession(request);
    const conditions: (SQL | undefined)[] = [tenantFilter(session.user, schema.taxonomies.tenantId)];
    if (query.data.cursor) {
      const c = decodeNameIdCursor(query.data.cursor);
      if (c) {
        const tupleAfter = or(
          gt(schema.taxonomies.name, c.name),
          and(
            eq(schema.taxonomies.name, c.name),
            gt(schema.taxonomies.id, c.id),
          ),
        );
        if (tupleAfter) conditions.push(tupleAfter);
      }
    }
    const rows = await db
      .select()
      .from(schema.taxonomies)
      .where(and(...conditions))
      .orderBy(asc(schema.taxonomies.name), asc(schema.taxonomies.id))
      .limit(query.data.limit + 1);
    const hasMore = rows.length > query.data.limit;
    const data = hasMore ? rows.slice(0, query.data.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last ? encodeNameIdCursor({ name: last.name, id: last.id }) : null;
    return {
      data,
      pagination: { nextCursor, hasMore, limit: query.data.limit },
    };
  });

  fastify.get('/:id', async (request, reply) => {
    const params = TaxonomyIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const session = getSession(request);
    const [row] = await db
      .select()
      .from(schema.taxonomies)
      .where(
        and(
          eq(schema.taxonomies.id, params.data.id),
          tenantFilter(session.user, schema.taxonomies.tenantId),
        ),
      )
      .limit(1);
    if (!row) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return { data: row };
  });

  fastify.post(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const parsed = CreateTaxonomyBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid request body',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      const session = getSession(request);
      try {
        const [row] = await db
          .insert(schema.taxonomies)
          .values({ ...parsed.data, tenantId: session.user.tenantId })
          .returning();
        if (row) {
          await logAudit({
            tenantId: session.user.tenantId,
            actorId: session.user.id,
            action: 'taxonomy.created',
            resourceType: 'taxonomy',
            resourceId: row.id,
            afterSnapshot: { name: row.name, slug: row.slug, kind: row.kind },
            request,
          });
        }
        return reply.code(201).send({ data: row });
      } catch (e: unknown) {
        if (isTaxonomyUniqueViolation(e)) {
          return reply
            .code(409)
            .send({ error: 'A taxonomy with this slug already exists' });
        }
        throw e;
      }
    },
  );

  fastify.patch(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = TaxonomyIdParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const body = UpdateTaxonomyBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: 'Invalid request body',
          issues: body.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      if (Object.keys(body.data).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }
      const session = getSession(request);

      // Cross-field check against the merged post-update row. A patch that
      // only sets `kind: 'tag'` on a previously hierarchical category would
      // otherwise leave is_hierarchical=true behind — invalid combo.
      if (body.data.kind !== undefined || body.data.isHierarchical !== undefined) {
        const [current] = await db
          .select({
            kind: schema.taxonomies.kind,
            isHierarchical: schema.taxonomies.isHierarchical,
          })
          .from(schema.taxonomies)
          .where(
            and(
              eq(schema.taxonomies.id, params.data.id),
              tenantFilter(session.user, schema.taxonomies.tenantId),
            ),
          )
          .limit(1);
        if (!current) return reply.code(404).send({ error: 'Not found' });
        const mergedKind = body.data.kind ?? current.kind;
        const mergedHier = body.data.isHierarchical ?? current.isHierarchical;
        if (mergedKind === 'tag' && mergedHier) {
          return reply.code(422).send({
            error: 'Tags cannot be hierarchical',
            issues: [
              {
                path: 'isHierarchical',
                message:
                  'Set isHierarchical=false in the same patch when changing kind to "tag".',
              },
            ],
          });
        }
      }

      try {
        const [row] = await db
          .update(schema.taxonomies)
          .set({ ...body.data, updatedAt: sql`now()` })
          .where(
            and(
              eq(schema.taxonomies.id, params.data.id),
              tenantFilter(session.user, schema.taxonomies.tenantId),
            ),
          )
          .returning();
        if (!row) {
          return reply.code(404).send({ error: 'Not found' });
        }
        await logAudit({
          tenantId: row.tenantId,
          actorId: session.user.id,
          action: 'taxonomy.updated',
          resourceType: 'taxonomy',
          resourceId: row.id,
          afterSnapshot: { name: row.name, slug: row.slug, kind: row.kind },
          metadata: { changed: Object.keys(body.data) },
          request,
        });
        return { data: row };
      } catch (e: unknown) {
        if (isTaxonomyUniqueViolation(e)) {
          return reply
            .code(409)
            .send({ error: 'A taxonomy with this slug already exists' });
        }
        throw e;
      }
    },
  );

  // DELETE cascades to taxonomy_terms (FK CASCADE), and to
  // content_taxonomy_terms (CASCADE on term delete).
  fastify.delete(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = TaxonomyIdParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const session = getSession(request);
      const [deleted] = await db
        .delete(schema.taxonomies)
        .where(
          and(
            eq(schema.taxonomies.id, params.data.id),
            tenantFilter(session.user, schema.taxonomies.tenantId),
          ),
        )
        .returning({
          id: schema.taxonomies.id,
          tenantId: schema.taxonomies.tenantId,
          name: schema.taxonomies.name,
          slug: schema.taxonomies.slug,
          kind: schema.taxonomies.kind,
        });
      if (!deleted) {
        return reply.code(404).send({ error: 'Not found' });
      }
      await logAudit({
        tenantId: deleted.tenantId,
        actorId: session.user.id,
        action: 'taxonomy.deleted',
        resourceType: 'taxonomy',
        resourceId: deleted.id,
        beforeSnapshot: { name: deleted.name, slug: deleted.slug, kind: deleted.kind },
        request,
      });
      return reply.code(204).send();
    },
  );

  // ─── Terms (nested under taxonomy) ──────────────────────────────────────

  fastify.get('/:taxonomyId/terms', async (request, reply) => {
    const params = TaxonomyScopeParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid taxonomyId' });
    }
    const session = getSession(request);
    if (
      !(await findTaxonomyInTenant(
        params.data.taxonomyId,
        session.user,
      ))
    ) {
      return reply.code(404).send({ error: 'Taxonomy not found' });
    }
    const rows = await db
      .select()
      .from(schema.taxonomyTerms)
      .where(eq(schema.taxonomyTerms.taxonomyId, params.data.taxonomyId))
      .orderBy(schema.taxonomyTerms.sortOrder, schema.taxonomyTerms.name);
    return { data: rows };
  });

  fastify.post(
    '/:taxonomyId/terms',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const params = TaxonomyScopeParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid taxonomyId' });
      }
      const body = CreateTermBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: 'Invalid request body',
          issues: body.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      const session = getSession(request);
      const taxonomy = await findTaxonomyInTenant(
        params.data.taxonomyId,
        session.user,
      );
      if (!taxonomy) {
        return reply.code(404).send({ error: 'Taxonomy not found' });
      }
      // Tags are by definition flat; parentId is meaningless and would
      // bypass the contract the rest of the UI assumes.
      if (taxonomy.kind === 'tag' && body.data.parentId) {
        return reply.code(422).send({
          error: 'Tag terms cannot have a parent',
          issues: [
            {
              path: 'parentId',
              message:
                'Tags are flat. Move this taxonomy to kind "category" first if you need nesting.',
            },
          ],
        });
      }
      // Cross-table slug-collision guard — flat-URL world. Only enforced
      // when the term belongs to a 'categories' or 'tags' taxonomy (those
      // share the publication root with static pages). Custom taxonomies
      // with other slugs aren't user-facing URLs and can collide freely.
      if (
        (taxonomy.slug === 'categories' || taxonomy.slug === 'tags') &&
        session.user.tenantId !== null
      ) {
        const collidesWith = await findSlugCollision({
          slug: body.data.slug,
          tenantId: session.user.tenantId,
        });
        if (collidesWith) {
          return reply
            .code(400)
            .send(collisionResponse(body.data.slug, collidesWith));
        }
      }
      try {
        const [row] = await db
          .insert(schema.taxonomyTerms)
          .values({
            ...body.data,
            taxonomyId: params.data.taxonomyId,
            tenantId: session.user.tenantId,
          })
          .returning();
        if (row) {
          await logAudit({
            tenantId: session.user.tenantId,
            actorId: session.user.id,
            action: 'taxonomy_term.created',
            resourceType: 'taxonomy_term',
            resourceId: row.id,
            afterSnapshot: { name: row.name, slug: row.slug },
            metadata: { taxonomyId: row.taxonomyId },
            request,
          });
        }
        return reply.code(201).send({ data: row });
      } catch (e: unknown) {
        if (isTermUniqueViolation(e)) {
          return reply.code(409).send({
            error: 'A term with this slug already exists in this taxonomy',
          });
        }
        throw e;
      }
    },
  );

  fastify.patch(
    '/:taxonomyId/terms/:termId',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const params = TermScopeParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id(s)' });
      }
      const body = UpdateTermBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: 'Invalid request body',
          issues: body.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      if (Object.keys(body.data).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }
      const session = getSession(request);
      // Reject parentId on a tag-kind taxonomy here too (PATCH can introduce
      // a parent on an existing term, not just create).
      if (body.data.parentId) {
        const taxonomy = await findTaxonomyInTenant(
          params.data.taxonomyId,
          session.user,
        );
        if (!taxonomy) {
          return reply.code(404).send({ error: 'Taxonomy not found' });
        }
        if (taxonomy.kind === 'tag') {
          return reply.code(422).send({
            error: 'Tag terms cannot have a parent',
            issues: [
              {
                path: 'parentId',
                message:
                  'Tags are flat. Move this taxonomy to kind "category" first if you need nesting.',
              },
            ],
          });
        }
      }
      // Slug-collision guard on PATCH — only fires when the slug is actually
      // changing AND the parent taxonomy is 'categories' or 'tags' (those
      // share the publication root with static pages; other taxonomies
      // never become URL segments).
      if (
        body.data.slug !== undefined &&
        session.user.tenantId !== null
      ) {
        const taxonomy = await findTaxonomyInTenant(
          params.data.taxonomyId,
          session.user,
        );
        if (
          taxonomy &&
          (taxonomy.slug === 'categories' || taxonomy.slug === 'tags')
        ) {
          const currentKind: 'category' | 'tag' =
            taxonomy.slug === 'categories' ? 'category' : 'tag';
          const collidesWith = await findSlugCollision({
            slug: body.data.slug,
            tenantId: session.user.tenantId,
            exclude: { kind: currentKind, id: params.data.termId },
          });
          if (collidesWith) {
            return reply
              .code(400)
              .send(collisionResponse(body.data.slug, collidesWith));
          }
        }
      }
      try {
        const [row] = await db
          .update(schema.taxonomyTerms)
          .set({ ...body.data, updatedAt: sql`now()` })
          .where(
            and(
              eq(schema.taxonomyTerms.id, params.data.termId),
              eq(schema.taxonomyTerms.taxonomyId, params.data.taxonomyId),
              tenantFilter(session.user, schema.taxonomyTerms.tenantId),
            ),
          )
          .returning();
        if (!row) {
          return reply.code(404).send({ error: 'Not found' });
        }
        await logAudit({
          tenantId: row.tenantId,
          actorId: session.user.id,
          action: 'taxonomy_term.updated',
          resourceType: 'taxonomy_term',
          resourceId: row.id,
          afterSnapshot: { name: row.name, slug: row.slug },
          metadata: {
            taxonomyId: row.taxonomyId,
            changed: Object.keys(body.data),
          },
          request,
        });
        return { data: row };
      } catch (e: unknown) {
        if (isTermUniqueViolation(e)) {
          return reply.code(409).send({
            error: 'A term with this slug already exists in this taxonomy',
          });
        }
        throw e;
      }
    },
  );

  fastify.delete(
    '/:taxonomyId/terms/:termId',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const params = TermScopeParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id(s)' });
      }
      const session = getSession(request);
      const [deleted] = await db
        .delete(schema.taxonomyTerms)
        .where(
          and(
            eq(schema.taxonomyTerms.id, params.data.termId),
            eq(schema.taxonomyTerms.taxonomyId, params.data.taxonomyId),
            tenantFilter(session.user, schema.taxonomyTerms.tenantId),
          ),
        )
        .returning({
          id: schema.taxonomyTerms.id,
          tenantId: schema.taxonomyTerms.tenantId,
          taxonomyId: schema.taxonomyTerms.taxonomyId,
          name: schema.taxonomyTerms.name,
          slug: schema.taxonomyTerms.slug,
        });
      if (!deleted) {
        return reply.code(404).send({ error: 'Not found' });
      }
      await logAudit({
        tenantId: deleted.tenantId,
        actorId: session.user.id,
        action: 'taxonomy_term.deleted',
        resourceType: 'taxonomy_term',
        resourceId: deleted.id,
        beforeSnapshot: { name: deleted.name, slug: deleted.slug },
        metadata: { taxonomyId: deleted.taxonomyId },
        request,
      });
      return reply.code(204).send();
    },
  );
};
