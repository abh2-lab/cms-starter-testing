import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { SQL } from 'drizzle-orm';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { FieldDefinitionsSchema } from '@cms/types';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { isReservedContentTypeSlug } from '../../lib/reserved-content-type-slugs.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import {
  decodeNameIdCursor,
  encodeNameIdCursor,
} from '../../lib/pagination.js';
import { logAudit } from '../../lib/audit.js';
import { invalidatePattern } from '../../lib/cache.js';
import { purgeWebCache } from '../../lib/purge-web-cache.js';

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

// `settings.taxonomies.{categories,tags}` may legitimately be either a single
// slug (legacy 1:1 binding from before per-type binding became multi-select)
// or an array of slugs. Coerce both to an array of strings on the wire so
// downstream code only ever handles arrays. Existing rows with a string value
// keep working untouched — re-saving the type normalizes them.
const SlugArraySchema = z.preprocess((v): unknown => {
  if (typeof v === 'string') return [v];
  // Array.isArray narrows to `any[]`; widen to unknown[] for the no-unsafe-
  // return rule. Element validation happens in the inner z.array(z.string()).
  if (Array.isArray(v)) return v as unknown[];
  if (v === undefined || v === null) return [];
  return v; // let zod reject the wrong shape below
}, z.array(z.string().min(1)).default([]));

const SettingsSchema = z
  .object({
    taxonomies: z
      .object({
        categories: SlugArraySchema,
        tags: SlugArraySchema,
      })
      .partial()
      .optional(),
    // Opt-in: when true, the publish transition rejects rows that have no
    // term in any of the bound `categories` taxonomies. Drafts can still be
    // saved category-less. Default false so existing CPTs and any non-news
    // CPTs (e.g. Author) are unaffected. Enabled for Decode's Article CPT
    // because the flat-URL frontend builds /<category>/<article> URLs from
    // the article's primary category — a category-less published article
    // would fall to the /uncategorized/<slug> defensive fallback, which is
    // never what an editor wants.
    requireCategoryOnPublish: z.boolean().optional(),
    // Per-content-type default post template (WordPress-style single template).
    // The key matches a post-template in packages/blocks; the theme maps it to
    // a layout. A per-post override (content.template_key) wins over this.
    templates: z
      .object({ default: z.string().max(255).optional() })
      .optional(),
    // Public submissions for this type are either form DATA ('information' → the
    // admin shows a table + CSV export) or real content ('post' → the normal
    // editor). Only meaningful when submissionAccess !== 'none'; defaulted so
    // every type carries a value.
    submissionKind: z.enum(['information', 'post']).default('information'),
    // Opt-in manual (drag) ordering. When true, the public archive orders this
    // type's listing by content.sort_order and the admin exposes the Reorder UI.
    manualOrder: z.boolean().optional(),
  })
  .passthrough() // tolerate forward-compat keys we don't yet validate
  .default({});

// previewPath: must start with `/` and must contain the `{slug}` placeholder
// (so every row resolves to a unique URL). It also supports a `{category}`
// placeholder — both are URL-encoded at preview-token time, and `{category}`
// falls back to `uncategorized` when the row has no primary category. Empty
// string is rejected; clients should send null to clear. Length caps the wire
// payload — long URL templates are a red flag, not a real use case.
const PreviewPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\//, 'must start with "/"')
  .refine((v) => v.includes('{slug}'), 'must include the {slug} placeholder');

const CreateContentTypeBody = z.object({
  name: NameSchema,
  slug: SlugSchema,
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  previewPath: PreviewPathSchema.nullable().optional(),
  fieldDefinitions: FieldDefinitionsSchema.default({ fields: [] }),
  settings: SettingsSchema,
  submissionAccess: z.enum(['none', 'authenticated', 'public']).optional(),
});

const UpdateContentTypeBody = CreateContentTypeBody.partial();

const IdParam = z.object({ id: z.string().uuid() });

const ListQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    // Programming error — every route here has requireAdminAuth as preHandler.
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// Tenant filter moved to ../../lib/tenant-scope.ts (tenantFilter) so
// super_admin bypasses scoping automatically.

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Error && e.message.includes('content_types_tenant_slug_uniq')
  );
}

function isForeignKeyViolation(e: unknown): boolean {
  return e instanceof Error && /foreign key|violates foreign/i.test(e.message);
}

// Verify every slug listed under settings.taxonomies.{categories,tags} exists
// in the caller's tenant AND has the matching kind. Returns null on success
// or a Zod-style issues array shaped for the existing 422 envelope. Centralised
// so POST and PATCH share the rule. The settings param is `unknown` because
// Zod's passthrough-shape inference doesn't line up cleanly with a typed
// signature under exactOptionalPropertyTypes; we re-narrow inside.
async function validateTaxonomyBindings(
  session: { role: string; tenantId: string | null },
  settings: unknown,
): Promise<{ path: string; message: string }[] | null> {
  if (!settings || typeof settings !== 'object') return null;
  const tx = (settings as { taxonomies?: unknown }).taxonomies;
  if (!tx || typeof tx !== 'object') return null;
  const txObj = tx as { categories?: unknown; tags?: unknown };
  const catSlugs = Array.isArray(txObj.categories)
    ? txObj.categories.filter((s): s is string => typeof s === 'string')
    : [];
  const tagSlugs = Array.isArray(txObj.tags)
    ? txObj.tags.filter((s): s is string => typeof s === 'string')
    : [];
  const allSlugs = [...new Set([...catSlugs, ...tagSlugs])];
  if (allSlugs.length === 0) return null;

  const rows = await db
    .select({
      slug: schema.taxonomies.slug,
      kind: schema.taxonomies.kind,
    })
    .from(schema.taxonomies)
    .where(
      and(
        inArray(schema.taxonomies.slug, allSlugs),
        tenantFilter(session, schema.taxonomies.tenantId),
      ),
    );
  const bySlug = new Map(rows.map((r) => [r.slug, r.kind]));
  const issues: { path: string; message: string }[] = [];

  for (const slug of catSlugs) {
    const kind = bySlug.get(slug);
    if (kind === undefined) {
      issues.push({
        path: `settings.taxonomies.categories`,
        message: `Unknown taxonomy slug "${slug}".`,
      });
    } else if (kind !== 'category') {
      issues.push({
        path: `settings.taxonomies.categories`,
        message: `"${slug}" is a ${kind}, not a category. Switch its kind on the Taxonomy page first.`,
      });
    }
  }
  for (const slug of tagSlugs) {
    const kind = bySlug.get(slug);
    if (kind === undefined) {
      issues.push({
        path: `settings.taxonomies.tags`,
        message: `Unknown taxonomy slug "${slug}".`,
      });
    } else if (kind !== 'tag') {
      issues.push({
        path: `settings.taxonomies.tags`,
        message: `"${slug}" is a ${kind}, not a tag. Switch its kind on the Taxonomy page first.`,
      });
    }
  }
  return issues.length > 0 ? issues : null;
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const adminContentTypesRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require auth. Mutations layer on a role check.
  fastify.addHook('preHandler', requireAdminAuth);

  // GET / — list content types scoped to the user's tenant.
  // Alphabetical by name; cursor is the (name, id) tuple of the last row so
  // ordering is preserved across pages even when two types share a name.
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
    const conditions: (SQL | undefined)[] = [tenantFilter(session.user, schema.contentTypes.tenantId)];
    if (query.data.cursor) {
      const c = decodeNameIdCursor(query.data.cursor);
      if (c) {
        const tupleAfter = or(
          gt(schema.contentTypes.name, c.name),
          and(
            eq(schema.contentTypes.name, c.name),
            gt(schema.contentTypes.id, c.id),
          ),
        );
        if (tupleAfter) conditions.push(tupleAfter);
      }
    }
    const rows = await db
      .select()
      .from(schema.contentTypes)
      .where(and(...conditions))
      .orderBy(asc(schema.contentTypes.name), asc(schema.contentTypes.id))
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

  // GET /:id — fetch one
  fastify.get('/:id', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const session = getSession(request);
    const [row] = await db
      .select()
      .from(schema.contentTypes)
      .where(
        and(
          eq(schema.contentTypes.id, params.data.id),
          tenantFilter(session.user, schema.contentTypes.tenantId),
        ),
      )
      .limit(1);
    if (!row) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return { data: row };
  });

  // POST / — create a tenant content type (admin+)
  fastify.post(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const parsed = CreateContentTypeBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid request body',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      // Reject slugs that collide with first-class entity names. Pages, media,
      // tenants, users etc. are not CPTs — registering a CPT with one of those
      // slugs misleads editors and breaks routing assumptions downstream.
      if (isReservedContentTypeSlug(parsed.data.slug)) {
        return reply.code(400).send({
          error: `Slug "${parsed.data.slug}" is reserved — it shadows a first-class entity (pages, media, tenants, users, settings, taxonomies, terms, etc.)`,
          code: 'reserved_content_type_slug',
        });
      }
      const session = getSession(request);
      const taxIssues = await validateTaxonomyBindings(
        session.user,
        parsed.data.settings,
      );
      if (taxIssues) {
        return reply.code(422).send({
          error: 'Invalid taxonomy bindings in settings',
          issues: taxIssues,
        });
      }
      try {
        const [row] = await db
          .insert(schema.contentTypes)
          .values({
            ...parsed.data,
            tenantId: session.user.tenantId,
            // isSystem stays false — system-type creation is not exposed via
            // this API. Future: super_admin route or DB seed.
          })
          .returning();
        if (row) {
          await logAudit({
            tenantId: row.tenantId,
            actorId: session.user.id,
            action: 'content_type.created',
            resourceType: 'content_type',
            resourceId: row.id,
            afterSnapshot: { name: row.name, slug: row.slug, icon: row.icon },
            request,
          });
        }
        return reply.code(201).send({ data: row });
      } catch (e: unknown) {
        if (isUniqueViolation(e)) {
          return reply
            .code(409)
            .send({ error: 'A content type with this slug already exists' });
        }
        throw e;
      }
    },
  );

  // PATCH /:id — partial update (admin+)
  fastify.patch(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const body = UpdateContentTypeBody.safeParse(request.body);
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
      // Same reserved-slug guard as POST, but only fires when the patch
      // actually changes slug (the immutable-once-content-exists check below
      // catches a different case: changing slug when entries already exist).
      if (
        body.data.slug !== undefined &&
        isReservedContentTypeSlug(body.data.slug)
      ) {
        return reply.code(400).send({
          error: `Slug "${body.data.slug}" is reserved — it shadows a first-class entity (pages, media, tenants, users, settings, taxonomies, terms, etc.)`,
          code: 'reserved_content_type_slug',
        });
      }
      const session = getSession(request);

      // Immutability: once content entries exist, the slug and existing field
      // names are locked (labels/helpText/validations stay editable, and adding
      // new fields is allowed).
      const [current] = await db
        .select({
          slug: schema.contentTypes.slug,
          fieldDefinitions: schema.contentTypes.fieldDefinitions,
        })
        .from(schema.contentTypes)
        .where(
          and(
            eq(schema.contentTypes.id, params.data.id),
            tenantFilter(session.user, schema.contentTypes.tenantId),
          ),
        )
        .limit(1);
      if (!current) {
        return reply.code(404).send({ error: 'Not found' });
      }
      const countRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.content)
        .where(eq(schema.content.contentTypeId, params.data.id));
      const hasEntries = (countRows[0]?.count ?? 0) > 0;
      if (hasEntries) {
        if (body.data.slug !== undefined && body.data.slug !== current.slug) {
          return reply.code(409).send({
            error: 'Slug is immutable once content entries exist',
          });
        }
        if (body.data.fieldDefinitions !== undefined) {
          const newNames = new Set(
            body.data.fieldDefinitions.fields.map((f) => f.name),
          );
          const lost = current.fieldDefinitions.fields
            .map((f) => f.name)
            .filter((n) => !newNames.has(n));
          if (lost.length > 0) {
            return reply.code(409).send({
              error: 'Field names are immutable once content entries exist',
              fields: lost,
            });
          }
        }
      }

      if (body.data.settings !== undefined) {
        const taxIssues = await validateTaxonomyBindings(
          session.user,
          body.data.settings,
        );
        if (taxIssues) {
          return reply.code(422).send({
            error: 'Invalid taxonomy bindings in settings',
            issues: taxIssues,
          });
        }
      }

      try {
        const [row] = await db
          .update(schema.contentTypes)
          .set({ ...body.data, updatedAt: sql`now()` })
          .where(
            and(
              eq(schema.contentTypes.id, params.data.id),
              tenantFilter(session.user, schema.contentTypes.tenantId),
            ),
          )
          .returning();
        if (!row) {
          return reply.code(404).send({ error: 'Not found' });
        }
        await logAudit({
          tenantId: row.tenantId,
          actorId: session.user.id,
          action: 'content_type.updated',
          resourceType: 'content_type',
          resourceId: row.id,
          afterSnapshot: { name: row.name, slug: row.slug, icon: row.icon },
          metadata: { changed: Object.keys(body.data) },
          request,
        });
        // Settings like manualOrder / submissionKind change how the public
        // archive is ordered and rendered, so drop this type's archive cache
        // (+ the web SWR HTML) instead of waiting out the 5-min TTL. Tenant-
        // scoped types only; global types are rare and fall back to the TTL.
        // Fail-open — the update has already committed.
        if (row.tenantId) {
          try {
            await invalidatePattern(
              `cache:archive:${row.tenantId}:${row.slug}:*`,
            );
            await purgeWebCache(request.log, row.tenantId);
          } catch (err) {
            request.log.warn(
              { err, id: row.id },
              'content-type cache invalidation failed',
            );
          }
        }
        return { data: row };
      } catch (e: unknown) {
        if (isUniqueViolation(e)) {
          return reply
            .code(409)
            .send({ error: 'A content type with this slug already exists' });
        }
        throw e;
      }
    },
  );

  // DELETE /:id — delete a non-system tenant type (admin+).
  // Postgres FK `content.content_type_id → content_types.id ON DELETE RESTRICT`
  // protects against deleting a type that still has content.
  fastify.delete(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const session = getSession(request);
      try {
        const [deleted] = await db
          .delete(schema.contentTypes)
          .where(
            and(
              eq(schema.contentTypes.id, params.data.id),
              tenantFilter(session.user, schema.contentTypes.tenantId),
              eq(schema.contentTypes.isSystem, false),
            ),
          )
          .returning({
            id: schema.contentTypes.id,
            tenantId: schema.contentTypes.tenantId,
            name: schema.contentTypes.name,
            slug: schema.contentTypes.slug,
            icon: schema.contentTypes.icon,
          });
        if (!deleted) {
          return reply
            .code(404)
            .send({ error: 'Not found or system type (cannot delete)' });
        }
        await logAudit({
          tenantId: deleted.tenantId,
          actorId: session.user.id,
          action: 'content_type.deleted',
          resourceType: 'content_type',
          resourceId: deleted.id,
          beforeSnapshot: { name: deleted.name, slug: deleted.slug, icon: deleted.icon },
          request,
        });
        return reply.code(204).send();
      } catch (e: unknown) {
        if (isForeignKeyViolation(e)) {
          return reply
            .code(409)
            .send({ error: 'Cannot delete: content rows reference this type' });
        }
        throw e;
      }
    },
  );
};
