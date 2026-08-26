import type {
  FastifyBaseLogger,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import type { FieldDefinition } from '@cms/types';
import { resolveSiteUrl } from '../../lib/site-url.js';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { buildContentDataSchema } from '../../lib/content-validator.js';
import { invalidateKeys, invalidatePattern } from '../../lib/cache.js';
import { purgeWebCache } from '../../lib/purge-web-cache.js';
import { logAudit } from '../../lib/audit.js';
import { generatePreviewToken } from '../../lib/preview-token.js';
import { buildPreviewPath } from '../../lib/preview-routes.js';
import { CONTENT_INDEX_NAME } from '../../lib/meili-indexing.js';
import { meili } from '../../lib/meili-client.js';
import { producers } from '../../lib/queue.js';
import { notifyAuthor, notifyReviewers } from '../../lib/review-notify.js';
import { dispatchEvent } from '../../lib/webhook-dispatch.js';

// ─── Status enum + state machine ───────────────────────────────────────────

// Mirror of the contentStatus pgEnum (packages/db/src/schema/content.ts).
const CONTENT_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'scheduled',
  'published',
  'archived',
] as const;

type ContentStatus = (typeof CONTENT_STATUSES)[number];

const ContentStatusSchema = z.enum(CONTENT_STATUSES);

// Allowed transitions, keyed by FROM status. Same-status is always disallowed.
// 'published' -> 'draft' is intentionally NOT allowed: take down via
// 'archived' then resurrect to 'draft' if you really need to.
const ALLOWED_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ['in_review', 'scheduled', 'published'],
  in_review: ['draft', 'approved'],
  approved: ['draft', 'scheduled', 'published'],
  scheduled: ['draft', 'published'],
  published: ['archived'],
  archived: ['draft'],
};

function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Validation schemas ────────────────────────────────────────────────────

const SlugSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    'must be lowercase alphanumeric + hyphens',
  );

const TitleSchema = z.string().min(1).max(500);

const CreateContentBody = z.object({
  contentTypeId: z.string().uuid(),
  title: TitleSchema,
  slug: SlugSchema,
  customFields: z.record(z.string(), z.unknown()).default({}),
  // Per-post template override (WordPress-style single template). Null clears
  // the override so the content type's default applies. Flows into the insert
  // (...rest) and the update (...changes) via the shared body shape.
  templateKey: z.string().max(255).nullable().optional(),
  locale: z.string().min(2).max(10).default('en'),
  translationGroupId: z.string().uuid().nullable().optional(),
  publishAt: z.string().datetime().nullable().optional(),
  unpublishAt: z.string().datetime().nullable().optional(),
  featured: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
});

// Extended SEO lives in the content_seo table (1:1 with content). When `seo`
// is supplied the full surface is upserted. sitemapPriority is a decimal string
// (e.g. "0.5") to match the numeric column; schemaOverrides is free-form JSON.
const SeoBody = z.object({
  metaTitle: z.string().max(500).nullable(),
  metaDescription: z.string().max(1000).nullable(),
  metaKeywords: z.array(z.string()).nullable(),
  ogTitle: z.string().max(500).nullable(),
  ogDescription: z.string().max(1000).nullable(),
  ogImageKey: z.string().max(1024).nullable(),
  ogType: z.string().max(50).nullable(),
  twitterCard: z.string().max(50).nullable(),
  twitterTitle: z.string().max(500).nullable(),
  twitterDescription: z.string().max(1000).nullable(),
  twitterImageKey: z.string().max(1024).nullable(),
  canonicalUrl: z.string().max(2048).nullable(),
  robotsIndex: z.boolean(),
  robotsFollow: z.boolean(),
  sitemapInclude: z.boolean(),
  sitemapPriority: z.string().max(8).nullable(),
  sitemapChangeFreq: z.string().max(20).nullable(),
  schemaType: z.string().max(50).nullable(),
  schemaOverrides: z.unknown(),
});

// UpdateContentBody: same shape minus contentTypeId (can't change type
// after creation) minus status (status changes go through /transitions).
// `seo` upserts the linked content_seo row. `taxonomyTermIds`, when present,
// replaces the full set of content_taxonomy_terms associations.
const UpdateContentBody = CreateContentBody.partial()
  .omit({ contentTypeId: true })
  .extend({
    seo: SeoBody.optional(),
    taxonomyTermIds: z.array(z.string().uuid()).optional(),
  });

const TransitionBody = z.object({
  toStatus: ContentStatusSchema,
  comment: z.string().max(500).nullable().optional(),
});

const ListQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // 1-based page index. When present, the endpoint switches from cursor-based
  // (infinite-scroll "Load more") pagination to offset-based numbered
  // pagination and returns total/totalPages so the admin list can render
  // numbered page controls. Absent → legacy cursor contract is preserved.
  page: z.coerce.number().int().min(1).optional(),
  status: ContentStatusSchema.optional(),
  contentTypeId: z.string().uuid().optional(),
  authorId: z.string().uuid().optional(),
  // Case-insensitive title substring search (used by the relation picker).
  q: z.string().min(1).max(255).optional(),
  // Quick filter for public submissions: 'user' = submitted by a logged-in
  // reader (custom_fields.submitter_user_id set); 'guest' = anonymous
  // submission (submitter_email set, submitter_user_id null).
  submittedBy: z.enum(['user', 'guest']).optional(),
  // Sort column for the offset/numbered list (admin ContentList). Absent →
  // legacy id-desc order (newest first). Only applied on the offset path;
  // the cursor path and the Meili search path keep their own ordering
  // (relevance for search).
  sort: z.enum(['title', 'updated_at', 'created_at']).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
  // Category filter: only content with an attachment to this taxonomy term.
  // Its presence also forces the standard DB path below, because the Meili
  // search index isn't filterable by taxonomy term.
  taxonomyTermId: z.string().uuid().optional(),
});

const IdParam = z.object({ id: z.string().uuid() });

// ─── Helpers ───────────────────────────────────────────────────────────────

function getSession(request: FastifyRequest) {
  const session = request.adminSession;
  if (!session) {
    throw new Error('adminSession missing — preHandler chain misconfigured');
  }
  return session;
}

// Replaced the per-file `contentTenantWhere` with the shared `tenantFilter`
// helper. `tenantFilter` returns `undefined` for super_admin (caller uses
// the union of every tenant's rows) and the same column-scoped filter as
// before for everyone else.

// drizzle-orm wraps driver failures in DrizzleQueryError ("Failed query: …");
// the Postgres detail that names the violated constraint lives on the error's
// `cause` chain. Match against the whole chain or every duplicate-slug POST
// surfaces as a 500 instead of the 409 the admin expects.
function errorChainText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur instanceof Error && depth < 5; depth++) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.join('\n');
}

function isContentUniqueViolation(e: unknown): boolean {
  return errorChainText(e).includes('content_tenant_type_slug_uniq');
}

function isForeignKeyViolation(e: unknown): boolean {
  return /foreign key|violates foreign/i.test(errorChainText(e));
}

function sendZodError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: 'Invalid request body',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  });
}

// Convert optional ISO date string to (Date | null | undefined) for Drizzle.
function toDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(v);
}

// Load a content type's field definitions, or null if the type doesn't exist.
async function loadFieldDefs(
  contentTypeId: string,
): Promise<FieldDefinition[] | null> {
  const [ct] = await db
    .select({ fieldDefinitions: schema.contentTypes.fieldDefinitions })
    .from(schema.contentTypes)
    .where(eq(schema.contentTypes.id, contentTypeId))
    .limit(1);
  return ct ? ct.fieldDefinitions.fields : null;
}

// Load the CPT settings — enough to drive the publish-time category-required
// gate (flat-URL world). Returns null when the type doesn't exist.
async function loadCptSettings(
  contentTypeId: string,
): Promise<Record<string, unknown> | null> {
  const [ct] = await db
    .select({ settings: schema.contentTypes.settings })
    .from(schema.contentTypes)
    .where(eq(schema.contentTypes.id, contentTypeId))
    .limit(1);
  return ct ? (ct.settings as Record<string, unknown> | null) : null;
}

// Count taxonomy-term attachments on the given content that belong to any of
// the supplied taxonomy slugs. Used by the publish gate to detect whether an
// article has at least one category attached. Returns 0 when bound taxonomy
// slug list is empty (no category bound to the CPT → nothing to require).
async function countCategoryAttachments(
  contentId: string,
  tenantId: string,
  categoryTaxonomySlugs: readonly string[],
): Promise<number> {
  if (categoryTaxonomySlugs.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.contentTaxonomyTerms)
    .innerJoin(
      schema.taxonomyTerms,
      eq(schema.contentTaxonomyTerms.termId, schema.taxonomyTerms.id),
    )
    .innerJoin(
      schema.taxonomies,
      eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
    )
    .where(
      and(
        eq(schema.contentTaxonomyTerms.contentId, contentId),
        eq(schema.taxonomies.tenantId, tenantId),
        inArray(schema.taxonomies.slug, [...categoryTaxonomySlugs]),
      ),
    );
  return row?.n ?? 0;
}

// 422 — the body was well-formed but the custom_fields failed the content
// type's field-definition rules.
function sendDataError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(422).send({
    error: 'Content data failed validation',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  });
}

// Fetch the linked content_seo row (1:1 with content), or null if not set yet.
async function fetchContentSeo(contentId: string) {
  const [row] = await db
    .select()
    .from(schema.contentSeo)
    .where(eq(schema.contentSeo.contentId, contentId))
    .limit(1);
  return row ?? null;
}

// Fetch the term ids associated with a content row via content_taxonomy_terms.
async function fetchContentTermIds(contentId: string): Promise<string[]> {
  const rows = await db
    .select({ termId: schema.contentTaxonomyTerms.termId })
    .from(schema.contentTaxonomyTerms)
    .where(eq(schema.contentTaxonomyTerms.contentId, contentId));
  return rows.map((r) => r.termId);
}

// Returns Meili's ranked id list for an admin search, or null on outage
// (caller falls back to the existing ilike path). Filters always include
// tenantId so a leaky filter config on the index can't surface another
// tenant's content; status/contentTypeId narrow when supplied.
function meiliFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function runAdminMeiliQuery(opts: {
  q: string;
  tenantId: string | null;
  status?: ContentStatus;
  contentTypeId?: string;
  limit: number;
  log: FastifyBaseLogger;
}): Promise<string[] | null> {
  const filters: string[] = [];
  // Meili documents store tenantId as either a string or null; both shapes
  // are filterable. The null check avoids JSON-stringifying the literal
  // "null" as a value.
  if (opts.tenantId === null) {
    filters.push('tenantId IS NULL');
  } else {
    filters.push(`tenantId = ${meiliFilterValue(opts.tenantId)}`);
  }
  if (opts.status) {
    filters.push(`status = ${meiliFilterValue(opts.status)}`);
  }
  if (opts.contentTypeId) {
    filters.push(`contentTypeId = ${meiliFilterValue(opts.contentTypeId)}`);
  }

  try {
    const result = await meili
      .index(CONTENT_INDEX_NAME)
      .search<{ id: string }>(opts.q, {
        filter: filters,
        limit: opts.limit,
        attributesToRetrieve: ['id'],
      });
    return result.hits.map((h) => h.id);
  } catch (err) {
    opts.log.warn(
      { err, q: opts.q },
      'meili admin search failed; falling back to ilike',
    );
    return null;
  }
}

// Best-effort invalidation of the public cache keys touched by a write to a
// content row. tenant_id null (global/system content) → noop. Cache failures
// are logged but never raised — the write that triggered this has already
// committed and must succeed regardless.
async function invalidatePublicContentCache(
  log: FastifyBaseLogger,
  tenantId: string | null,
  contentTypeId: string,
  contentSlug: string,
): Promise<void> {
  if (!tenantId) return;
  try {
    const [typeRow] = await db
      .select({ slug: schema.contentTypes.slug })
      .from(schema.contentTypes)
      .where(eq(schema.contentTypes.id, contentTypeId))
      .limit(1);
    if (!typeRow) return;
    await invalidateKeys([
      `cache:content:${tenantId}:${typeRow.slug}:${contentSlug}`,
    ]);
    await invalidatePattern(`cache:archive:${tenantId}:${typeRow.slug}:*`);
    // Also drop the web (Nitro SWR) HTML cache: the home/stories/archive pages
    // render lists of these posts, so their cached HTML must drop too or the
    // edit lags by up to the 5-min TTL. Fail-open — never blocks the save.
    await purgeWebCache(log, tenantId);
  } catch (err) {
    log.warn(
      { err, contentTypeId, contentSlug },
      'public cache invalidation failed',
    );
  }
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const adminContentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // PUT /reorder — batch-set sort_order on rows of ONE content type, in a single
  // transaction. Powers the team grid's drag-to-reorder + "Sort A→Z" button in
  // the admin; the public archive reads this order via ?sort=order. Scoped to the
  // caller's tenant AND the given type, so a stray id can't touch another
  // tenant's or type's rows. Static path, so Fastify matches it ahead of /:id.
  const ReorderBody = z.object({
    contentTypeId: z.string().uuid(),
    items: z
      .array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() }))
      .min(1)
      .max(2000),
  });
  fastify.put(
    '/reorder',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const body = ReorderBody.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(400)
          .send({ error: 'invalid body', issues: body.error.flatten() });
      }
      const session = getSession(request);
      const { contentTypeId, items } = body.data;
      await db.transaction(async (tx) => {
        for (const item of items) {
          await tx
            .update(schema.content)
            .set({ sortOrder: item.sortOrder })
            .where(
              and(
                eq(schema.content.id, item.id),
                eq(schema.content.contentTypeId, contentTypeId),
                tenantFilter(session.user, schema.content.tenantId),
              ),
            );
        }
      });
      // Drop this type's archive cache so the new order shows without waiting out
      // the 5-min TTL. Fail-open — the reorder has already committed.
      try {
        const [typeRow] = await db
          .select({ slug: schema.contentTypes.slug })
          .from(schema.contentTypes)
          .where(eq(schema.contentTypes.id, contentTypeId))
          .limit(1);
        if (typeRow && session.user.tenantId) {
          await invalidatePattern(
            `cache:archive:${session.user.tenantId}:${typeRow.slug}:*`,
          );
          await purgeWebCache(request.log, session.user.tenantId);
        }
      } catch (err) {
        request.log.warn(
          { err, contentTypeId },
          'reorder cache invalidation failed',
        );
      }
      return { data: { ok: true } };
    },
  );

  // POST /reorder/reset — clear the hand-set order for ONE type back to
  // newest-first: set every row's sort_order to 0, so `sort=order`'s
  // asc(sortOrder) collapses to the desc(id) tiebreak (uuidv7 ≈ newest). One
  // statement; resets ALL rows, not just a page. The manualOrder setting stays on.
  const ResetOrderBody = z.object({ contentTypeId: z.string().uuid() });
  fastify.post(
    '/reorder/reset',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const body = ResetOrderBody.safeParse(request.body);
      if (!body.success) {
        return reply
          .code(400)
          .send({ error: 'invalid body', issues: body.error.flatten() });
      }
      const session = getSession(request);
      const { contentTypeId } = body.data;
      await db
        .update(schema.content)
        .set({ sortOrder: 0 })
        .where(
          and(
            eq(schema.content.contentTypeId, contentTypeId),
            tenantFilter(session.user, schema.content.tenantId),
          ),
        );
      try {
        const [typeRow] = await db
          .select({ slug: schema.contentTypes.slug })
          .from(schema.contentTypes)
          .where(eq(schema.contentTypes.id, contentTypeId))
          .limit(1);
        if (typeRow && session.user.tenantId) {
          await invalidatePattern(
            `cache:archive:${session.user.tenantId}:${typeRow.slug}:*`,
          );
          await purgeWebCache(request.log, session.user.tenantId);
        }
      } catch (err) {
        request.log.warn(
          { err, contentTypeId },
          'reorder-reset cache invalidation failed',
        );
      }
      return { data: { ok: true } };
    },
  );

  // GET / — list with cursor pagination + optional filters.
  //
  // When `q` is present we route through Meili: ask for matching content ids
  // (relevance-ordered), then SELECT * FROM content WHERE id = ANY(ids) and
  // restore the Meili order client-side. This keeps the response shape
  // identical to the non-search case so ContentList.vue needs zero changes.
  //
  // Search results are capped at MEILI_ADMIN_SEARCH_LIMIT and returned with
  // hasMore=false / nextCursor=null — deeper pagination would require
  // mapping Meili's offset/limit onto the cursor model, which adds complexity
  // for a query type that nobody paginates 100 deep through anyway.
  //
  // On a Meili outage we fall back to the original ilike-on-title path.
  // Browsing must keep working even with search down.
  const MEILI_ADMIN_SEARCH_LIMIT = 100;
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

    // Enrich a page of content rows with their primary category slug (first
    // term in the `categories` taxonomy) so the list's "View on site" action
    // can substitute the `{category}` permalink token. One batched query keyed
    // by the page's ids keeps the main list query from fanning out.
    const withPrimaryCategory = async <T extends { id: string }>(
      list: T[],
    ): Promise<(T & { primaryCategorySlug: string | null })[]> => {
      if (list.length === 0) return [];
      const catRows = await db
        .select({
          contentId: schema.contentTaxonomyTerms.contentId,
          termSlug: schema.taxonomyTerms.slug,
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
        .where(
          and(
            inArray(
              schema.contentTaxonomyTerms.contentId,
              list.map((r) => r.id),
            ),
            eq(schema.taxonomies.slug, 'categories'),
          ),
        );
      const byContent = new Map<string, string>();
      for (const c of catRows) {
        if (!byContent.has(c.contentId)) byContent.set(c.contentId, c.termSlug);
      }
      return list.map((r) => ({
        ...r,
        primaryCategorySlug: byContent.get(r.id) ?? null,
      }));
    };

    if (query.data.q && !query.data.submittedBy && !query.data.taxonomyTermId) {
      const meiliIds = await runAdminMeiliQuery({
        q: query.data.q,
        tenantId: session.user.tenantId,
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(query.data.contentTypeId
          ? { contentTypeId: query.data.contentTypeId }
          : {}),
        limit: MEILI_ADMIN_SEARCH_LIMIT,
        log: request.log,
      });
      if (meiliIds !== null) {
        // Meili returns up to MEILI_ADMIN_SEARCH_LIMIT relevance-ordered ids;
        // that capped set is the total we paginate over. When `page` is given
        // we slice it to the requested window and only fetch that page's rows;
        // legacy callers (no `page`) get the whole set as before.
        const total = meiliIds.length;
        const totalPages = Math.max(1, Math.ceil(total / query.data.limit));
        const paged = query.data.page !== undefined;
        const page = query.data.page ?? 1;
        const start = paged ? (page - 1) * query.data.limit : 0;
        const pageIds = paged
          ? meiliIds.slice(start, start + query.data.limit)
          : meiliIds;
        if (pageIds.length === 0) {
          return {
            data: [],
            pagination: {
              nextCursor: null,
              hasMore: false,
              limit: query.data.limit,
              page,
              total,
              totalPages,
            },
          };
        }
        // Server-side filter ensures we never return a row outside the
        // caller's tenant even if Meili's filterable attrs drift.
        const rows = await db
          .select()
          .from(schema.content)
          .where(
            and(
              tenantFilter(session.user, schema.content.tenantId),
              inArray(schema.content.id, pageIds),
            ),
          );
        // Reorder to match Meili's relevance ranking.
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = pageIds
          .map((id) => byId.get(id))
          .filter((r): r is (typeof rows)[number] => r !== undefined);
        return {
          data: await withPrimaryCategory(ordered),
          pagination: {
            nextCursor: null,
            hasMore: paged ? page < totalPages : false,
            limit: query.data.limit,
            page,
            total,
            totalPages,
          },
        };
      }
      // Meili down — fall back to ilike (handled by the standard path below
      // because conditions.push for q is in the shared block).
    }

    const conditions: (SQL | undefined)[] = [
      tenantFilter(session.user, schema.content.tenantId),
    ];
    if (query.data.status) {
      conditions.push(eq(schema.content.status, query.data.status));
    }
    if (query.data.contentTypeId) {
      conditions.push(
        eq(schema.content.contentTypeId, query.data.contentTypeId),
      );
    }
    if (query.data.authorId) {
      conditions.push(eq(schema.content.authorId, query.data.authorId));
    }
    if (query.data.submittedBy === 'user') {
      conditions.push(
        sql`${schema.content.customFields} ->> 'submitter_user_id' IS NOT NULL`,
      );
    } else if (query.data.submittedBy === 'guest') {
      conditions.push(
        sql`${schema.content.customFields} ->> 'submitter_email' IS NOT NULL AND ${schema.content.customFields} ->> 'submitter_user_id' IS NULL`,
      );
    }
    if (query.data.taxonomyTermId) {
      // Only rows that carry an attachment to this taxonomy term. EXISTS keeps
      // the row set to one-per-content even if a row matched multiple ways.
      conditions.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(schema.contentTaxonomyTerms)
            .where(
              and(
                eq(schema.contentTaxonomyTerms.contentId, schema.content.id),
                eq(
                  schema.contentTaxonomyTerms.termId,
                  query.data.taxonomyTermId,
                ),
              ),
            ),
        ),
      );
    }
    if (query.data.q) {
      conditions.push(ilike(schema.content.title, `%${query.data.q}%`));
    }
    // `conditions` holds every filter EXCEPT the cursor — reuse it for the
    // total count so the count reflects the whole filtered set, not one page.
    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.content)
      .where(and(...conditions));
    const total = totalRows[0]?.n ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / query.data.limit));

    // Offset/numbered pagination when `page` is supplied; otherwise fall back
    // to the legacy cursor (infinite-scroll) contract for back-compat.
    if (query.data.page !== undefined) {
      const offset = (query.data.page - 1) * query.data.limit;
      // Default (no sort param) keeps the legacy newest-first id order. With a
      // sort column, order by it and add id DESC as a stable tiebreak so paging
      // stays deterministic when the sort values tie.
      const sortCol =
        query.data.sort === 'title'
          ? schema.content.title
          : query.data.sort === 'created_at'
            ? schema.content.createdAt
            : query.data.sort === 'updated_at'
              ? schema.content.updatedAt
              : null;
      const listOrderBy = sortCol
        ? [
            query.data.dir === 'asc' ? asc(sortCol) : desc(sortCol),
            desc(schema.content.id),
          ]
        : [desc(schema.content.id)];
      const pageRows = await db
        .select()
        .from(schema.content)
        .where(and(...conditions))
        .orderBy(...listOrderBy)
        .limit(query.data.limit)
        .offset(offset);
      return {
        data: await withPrimaryCategory(pageRows),
        pagination: {
          nextCursor: null,
          hasMore: query.data.page < totalPages,
          limit: query.data.limit,
          page: query.data.page,
          total,
          totalPages,
        },
      };
    }

    const cursorConditions = query.data.cursor
      ? [...conditions, lt(schema.content.id, query.data.cursor)]
      : conditions;
    const rows = await db
      .select()
      .from(schema.content)
      .where(and(...cursorConditions))
      .orderBy(desc(schema.content.id))
      .limit(query.data.limit + 1);

    const hasMore = rows.length > query.data.limit;
    const data = hasMore ? rows.slice(0, query.data.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return {
      data: await withPrimaryCategory(data),
      pagination: {
        nextCursor,
        hasMore,
        limit: query.data.limit,
        page: 1,
        total,
        totalPages,
      },
    };
  });

  // GET /counts — tenant-wide status tallies for the ContentList stat strip.
  // Always unfiltered (minus tenant scope) so the tiles read as stable KPIs,
  // not a preview of the active filter — same contract as the pages list. A
  // static path, so find-my-way matches it ahead of GET /:id.
  fastify.get('/counts', async (request) => {
    const session = getSession(request);
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        published: sql<number>`count(*) filter (where ${schema.content.status} = 'published')::int`,
        drafts: sql<number>`count(*) filter (where ${schema.content.status} = 'draft')::int`,
        inReview: sql<number>`count(*) filter (where ${schema.content.status} = 'in_review')::int`,
        scheduled: sql<number>`count(*) filter (where ${schema.content.status} = 'scheduled')::int`,
      })
      .from(schema.content)
      .where(tenantFilter(session.user, schema.content.tenantId));
    return {
      data: {
        total: row?.total ?? 0,
        published: row?.published ?? 0,
        drafts: row?.drafts ?? 0,
        inReview: row?.inReview ?? 0,
        scheduled: row?.scheduled ?? 0,
      },
    };
  });

  // GET /:id — fetch a single content row (tenant-scoped)
  fastify.get('/:id', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const session = getSession(request);
    const [row] = await db
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.id, params.data.id),
          tenantFilter(session.user, schema.content.tenantId),
        ),
      )
      .limit(1);
    if (!row) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return {
      data: {
        ...row,
        seo: await fetchContentSeo(row.id),
        taxonomyTermIds: await fetchContentTermIds(row.id),
      },
    };
  });

  // POST / — create a draft content row (author+).
  // status always starts at 'draft'; author_id is forced to the caller.
  fastify.post(
    '/',
    { preHandler: requireAdminRole('author') },
    async (request, reply) => {
      const parsed = CreateContentBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const session = getSession(request);

      // Validate custom_fields against the content type's field definitions.
      const fields = await loadFieldDefs(parsed.data.contentTypeId);
      if (fields === null) {
        return reply.code(400).send({
          error: 'Invalid contentTypeId (no such content type)',
        });
      }
      // Drafts may be incomplete — required fields are enforced at publish
      // time (see the transitions handler), not on create.
      const dataResult = buildContentDataSchema(fields, {
        partial: true,
      }).safeParse(parsed.data.customFields);
      if (!dataResult.success) return sendDataError(reply, dataResult.error);

      const { publishAt, unpublishAt, ...rest } = parsed.data;
      rest.customFields = dataResult.data as Record<string, unknown>;
      try {
        const [row] = await db
          .insert(schema.content)
          .values({
            ...rest,
            tenantId: session.user.tenantId,
            authorId: session.user.id,
            publishAt: toDateOrNull(publishAt) ?? null,
            unpublishAt: toDateOrNull(unpublishAt) ?? null,
          })
          .returning();
        if (row) {
          // Best-effort outside any transaction — failure here must not block
          // a successful create. Snapshot keeps the title so the dashboard
          // feed can render "Created <title>" even after the row is deleted.
          await logAudit({
            tenantId: session.user.tenantId,
            actorId: session.user.id,
            action: 'content.created',
            resourceType: 'content',
            resourceId: row.id,
            afterSnapshot: { title: row.title, slug: row.slug },
            request,
          });
          // Enqueue the search index upsert — drafts go in too so admin
          // search finds them. The public route's status filter keeps drafts
          // out of public search. Fire-and-forget: a Dragonfly outage on
          // enqueue logs a warning but never blocks the user's create.
          void producers.searchIndex
            .upsert(row.id, 'create', request.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: row.id },
                'enqueue search-index upsert failed',
              );
            });
          void dispatchEvent(
            request.log,
            'content.created',
            {
              id: row.id,
              slug: row.slug,
              status: row.status,
              contentTypeId: row.contentTypeId,
            },
            row.tenantId,
            request.id,
          );
        }
        return reply.code(201).send({ data: row });
      } catch (e: unknown) {
        if (isContentUniqueViolation(e)) {
          return reply.code(409).send({
            error: 'A content row with this slug already exists for this type',
          });
        }
        if (isForeignKeyViolation(e)) {
          return reply.code(400).send({
            error: 'Invalid contentTypeId (no such content type in your tenant)',
          });
        }
        throw e;
      }
    },
  );

  // PATCH /:id — partial update. Records a revision snapshot of the current
  // row before applying changes, all in one transaction (with a row lock so
  // concurrent writers serialize cleanly). Status changes are NOT accepted
  // here — use /:id/transitions instead.
  fastify.patch(
    '/:id',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const body = UpdateContentBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      if (Object.keys(body.data).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      const session = getSession(request);

      // Validate custom_fields (if provided) against the type's definitions.
      let validatedCustomFields: Record<string, unknown> | undefined;
      if (body.data.customFields !== undefined) {
        const [ct] = await db
          .select({ contentTypeId: schema.content.contentTypeId })
          .from(schema.content)
          .where(
            and(
              eq(schema.content.id, params.data.id),
              tenantFilter(session.user, schema.content.tenantId),
            ),
          )
          .limit(1);
        if (!ct) return reply.code(404).send({ error: 'Not found' });
        const fields = await loadFieldDefs(ct.contentTypeId);
        if (fields) {
          // Partial: editing a draft never blocks on missing required fields.
          const dataResult = buildContentDataSchema(fields, {
            partial: true,
          }).safeParse(body.data.customFields);
          if (!dataResult.success) {
            return sendDataError(reply, dataResult.error);
          }
          validatedCustomFields = dataResult.data as Record<string, unknown>;
        }
      }

      // Validate taxonomy term ids (existence + tenant scope) before the txn
      // so a bad id yields a clean 400 rather than a raw FK violation.
      if (body.data.taxonomyTermIds && body.data.taxonomyTermIds.length > 0) {
        const ids = [...new Set(body.data.taxonomyTermIds)];
        const found = await db
          .select({ id: schema.taxonomyTerms.id })
          .from(schema.taxonomyTerms)
          .where(
            and(
              inArray(schema.taxonomyTerms.id, ids),
              tenantFilter(session.user, schema.taxonomyTerms.tenantId),
            ),
          );
        if (found.length !== ids.length) {
          return reply.code(400).send({
            error: 'One or more taxonomy term ids are invalid for this tenant',
          });
        }
      }

      // Stashed inside the txn for cache invalidation after commit — when
      // slug or contentTypeId changed, the OLD key needs invalidation too.
      let previousContentTypeId: string | undefined;
      let previousSlug: string | undefined;

      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(schema.content)
          .where(
            and(
              eq(schema.content.id, params.data.id),
              tenantFilter(session.user, schema.content.tenantId),
            ),
          )
          .for('update')
          .limit(1);
        if (!current) return null;

        previousContentTypeId = current.contentTypeId;
        previousSlug = current.slug;

        // Compute next revision_number under the lock.
        const [counterRow] = await tx
          .select({
            next: sql<number>`COALESCE(MAX(${schema.contentRevisions.revisionNumber}), 0) + 1`,
          })
          .from(schema.contentRevisions)
          .where(eq(schema.contentRevisions.contentId, current.id));

        await tx.insert(schema.contentRevisions).values({
          contentId: current.id,
          tenantId: current.tenantId,
          snapshot: current,
          changedBy: session.user.id,
          revisionNumber: Number(counterRow?.next ?? 1),
        });

        const { publishAt, unpublishAt, seo, taxonomyTermIds, ...changes } =
          body.data;
        const updateSet: Record<string, unknown> = {
          ...changes,
          updatedAt: sql`now()`,
        };
        if (validatedCustomFields !== undefined) {
          updateSet['customFields'] = validatedCustomFields;
        }
        if (publishAt !== undefined) {
          updateSet['publishAt'] = toDateOrNull(publishAt);
        }
        if (unpublishAt !== undefined) {
          updateSet['unpublishAt'] = toDateOrNull(unpublishAt);
        }

        const [updated] = await tx
          .update(schema.content)
          .set(updateSet)
          .where(eq(schema.content.id, current.id))
          .returning();
        if (!updated) return null;

        // Upsert the 1:1 content_seo row when seo is supplied.
        if (seo !== undefined) {
          const seoValues = {
            metaTitle: seo.metaTitle,
            metaDescription: seo.metaDescription,
            metaKeywords: seo.metaKeywords,
            ogTitle: seo.ogTitle,
            ogDescription: seo.ogDescription,
            ogImageKey: seo.ogImageKey,
            ogType: seo.ogType,
            twitterCard: seo.twitterCard,
            twitterTitle: seo.twitterTitle,
            twitterDescription: seo.twitterDescription,
            twitterImageKey: seo.twitterImageKey,
            canonicalUrl: seo.canonicalUrl,
            robotsIndex: seo.robotsIndex,
            robotsFollow: seo.robotsFollow,
            sitemapInclude: seo.sitemapInclude,
            sitemapPriority: seo.sitemapPriority,
            sitemapChangeFreq: seo.sitemapChangeFreq,
            schemaType: seo.schemaType,
            schemaOverrides: seo.schemaOverrides,
          };
          await tx
            .insert(schema.contentSeo)
            .values({
              contentId: updated.id,
              tenantId: updated.tenantId,
              ...seoValues,
            })
            .onConflictDoUpdate({
              target: schema.contentSeo.contentId,
              set: seoValues,
            });
        }

        // Replace the full set of taxonomy term associations when supplied.
        if (taxonomyTermIds !== undefined) {
          await tx
            .delete(schema.contentTaxonomyTerms)
            .where(eq(schema.contentTaxonomyTerms.contentId, updated.id));
          const uniqueIds = [...new Set(taxonomyTermIds)];
          if (uniqueIds.length > 0) {
            await tx.insert(schema.contentTaxonomyTerms).values(
              uniqueIds.map((termId) => ({
                contentId: updated.id,
                termId,
              })),
            );
          }
        }

        // Audit inside the transaction: an audit-side failure should roll
        // back the user-facing write (same rationale as the revision insert
        // above — audit drift here is worse than a failed save).
        await logAudit({
          tx,
          tenantId: updated.tenantId,
          actorId: session.user.id,
          action: 'content.updated',
          resourceType: 'content',
          resourceId: updated.id,
          beforeSnapshot: { title: current.title, slug: current.slug },
          afterSnapshot: { title: updated.title, slug: updated.slug },
          request,
        });

        return updated;
      });

      if (!result) {
        return reply.code(404).send({ error: 'Not found' });
      }

      // Invalidate the current keys; if slug or content_type changed in this
      // update, also drop the keys under the previous (type, slug) so the old
      // URL stops serving the now-renamed content.
      await invalidatePublicContentCache(
        request.log,
        result.tenantId,
        result.contentTypeId,
        result.slug,
      );
      if (
        previousContentTypeId &&
        previousSlug &&
        (previousContentTypeId !== result.contentTypeId ||
          previousSlug !== result.slug)
      ) {
        await invalidatePublicContentCache(
          request.log,
          result.tenantId,
          previousContentTypeId,
          previousSlug,
        );
      }

      // Enqueue a reindex — picks up title/body/SEO edits so admin + public
      // search see the latest. The worker retries with backoff if Meili is
      // briefly down; failures are visible in Bull Board.
      void producers.searchIndex
        .upsert(result.id, 'update', request.id)
        .catch((err: unknown) => {
          request.log.warn(
            { err, contentId: result.id },
            'enqueue search-index upsert failed',
          );
        });
      void dispatchEvent(
        request.log,
        'content.updated',
        {
          id: result.id,
          slug: result.slug,
          status: result.status,
          contentTypeId: result.contentTypeId,
        },
        result.tenantId,
        request.id,
      );

      // Reconcile scheduled (un)publish jobs with the row's new shape. PATCH
      // can change publishAt/unpublishAt independently of status, so a hook
      // here keeps the queue in sync without forcing editors through a
      // status transition just to reschedule.
      if (body.data.publishAt !== undefined) {
        if (result.publishAt && result.status === 'scheduled') {
          void producers.schedule
            .publishAt(result.id, result.publishAt, request.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: result.id },
                'enqueue schedule-publish failed',
              );
            });
        } else {
          void producers.schedule
            .cancelPublish(result.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: result.id },
                'cancel schedule-publish failed',
              );
            });
        }
      }
      if (body.data.unpublishAt !== undefined) {
        if (result.unpublishAt && result.status === 'published') {
          void producers.schedule
            .unpublishAt(result.id, result.unpublishAt, request.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: result.id },
                'enqueue schedule-unpublish failed',
              );
            });
        } else {
          void producers.schedule
            .cancelUnpublish(result.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: result.id },
                'cancel schedule-unpublish failed',
              );
            });
        }
      }

      return {
        data: {
          ...result,
          seo: await fetchContentSeo(result.id),
          taxonomyTermIds: await fetchContentTermIds(result.id),
        },
      };
    },
  );

  // POST /:id/transitions — state-machine status change (editor+).
  // Records a row in content_status_transitions. Side effects per target:
  //   published   → set published_at (if null), set published_by
  //   scheduled   → 400 if publish_at is null
  fastify.post(
    '/:id/transitions',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const body = TransitionBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      const session = getSession(request);

      const outcome = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(schema.content)
          .where(
            and(
              eq(schema.content.id, params.data.id),
              tenantFilter(session.user, schema.content.tenantId),
            ),
          )
          .for('update')
          .limit(1);
        if (!current) {
          return { kind: 'not_found' as const };
        }

        const from = current.status;
        const to = body.data.toStatus;
        if (!canTransition(from, to)) {
          return { kind: 'invalid_transition' as const, from, to };
        }
        if (to === 'scheduled' && !current.publishAt) {
          return { kind: 'requires_publish_at' as const };
        }

        // Going live: now enforce the content type's required fields against
        // the stored custom_fields. Drafts are allowed to be incomplete, but
        // publishing (or scheduling an auto-publish) is the gate where the
        // full field-definition rules must hold.
        if (to === 'published' || to === 'scheduled') {
          const fields = await loadFieldDefs(current.contentTypeId);
          if (fields) {
            const dataResult = buildContentDataSchema(fields).safeParse(
              current.customFields,
            );
            if (!dataResult.success) {
              return {
                kind: 'invalid_data' as const,
                error: dataResult.error,
              };
            }
          }

          // Category-required gate (flat-URL world). When the CPT opts in
          // via settings.requireCategoryOnPublish=true AND has at least one
          // category taxonomy bound, count the row's category attachments
          // and reject the transition if none. The frontend canonical URL
          // is /<category>/<article>; publishing without a category would
          // fall to /uncategorized/<slug>, which is the defensive fallback
          // and not editor intent.
          const settings = await loadCptSettings(current.contentTypeId);
          if (
            settings &&
            typeof settings === 'object' &&
            settings['requireCategoryOnPublish'] === true &&
            current.tenantId !== null
          ) {
            const tax = settings['taxonomies'];
            const boundCategorySlugs: string[] =
              tax !== null &&
              typeof tax === 'object' &&
              'categories' in tax &&
              Array.isArray((tax as { categories?: unknown }).categories)
                ? (tax as { categories: unknown[] }).categories.filter(
                    (s): s is string => typeof s === 'string',
                  )
                : [];
            if (boundCategorySlugs.length > 0) {
              const count = await countCategoryAttachments(
                current.id,
                current.tenantId,
                boundCategorySlugs,
              );
              if (count === 0) {
                return {
                  kind: 'category_required' as const,
                  boundCategorySlugs,
                };
              }
            }
          }
        }

        const updates: Record<string, unknown> = {
          status: to,
          updatedAt: sql`now()`,
        };
        if (to === 'published') {
          // Stamp the server-side timestamps from the DATABASE clock
          // (sql`now()`), never the app clock. The public visibility filter
          // compares publish_at against Postgres's now(); if we wrote the app
          // clock and the API process clock leads Postgres's (host-run API vs
          // Dockerized PG on a lagging WSL2 clock), the just-written publish_at
          // reads as future-dated for a beat, the public loader returns null,
          // and that 404 risks being cached. Writing the DB clock closes the
          // skew window at the source. (updatedAt above already uses now().)
          if (!current.publishedAt) {
            updates['publishedAt'] = sql`now()`;
          }
          updates['publishedBy'] = session.user.id;
          // Clamp a future publish_at down to now so the archive's
          // `publish_at IS NULL OR publish_at <= NOW()` visibility filter
          // accepts a manually-published post whose editor input still carried
          // a future scheduled timestamp. A past publish_at is left alone —
          // that's a legitimate scheduled-then-published-early row and
          // preserving it keeps the historical ordering correct. The decision
          // compares current.publishAt (a JS Date) against the app clock; being
          // off by the cross-clock skew at the boundary only shifts a near-now
          // publish by a second, and clamping a manual publish to now() is
          // always correct. The value written is the DB clock, per above.
          if (current.publishAt === null || current.publishAt > new Date()) {
            updates['publishAt'] = sql`now()`;
          }
        }

        const [updated] = await tx
          .update(schema.content)
          .set(updates)
          .where(eq(schema.content.id, current.id))
          .returning();

        await tx.insert(schema.contentStatusTransitions).values({
          contentId: current.id,
          fromStatus: from,
          toStatus: to,
          changedBy: session.user.id,
          comment: body.data.comment ?? null,
        });

        // Audit inside the transaction. metadata carries from/to so the
        // dashboard can render "Published" vs "Unscheduled" vs raw labels.
        await logAudit({
          tx,
          tenantId: updated?.tenantId ?? current.tenantId,
          actorId: session.user.id,
          action: 'content.transitioned',
          resourceType: 'content',
          resourceId: current.id,
          afterSnapshot: { title: current.title, slug: current.slug },
          metadata: {
            from,
            to,
            comment: body.data.comment ?? null,
          },
          request,
        });

        return { kind: 'ok' as const, content: updated, from };
      });

      if (outcome.kind === 'not_found') {
        return reply.code(404).send({ error: 'Not found' });
      }
      if (outcome.kind === 'invalid_transition') {
        return reply.code(409).send({
          error: `Cannot transition from ${outcome.from} to ${outcome.to}`,
          allowed: ALLOWED_TRANSITIONS[outcome.from],
        });
      }
      if (outcome.kind === 'requires_publish_at') {
        return reply.code(400).send({
          error: 'Scheduled status requires publish_at to be set first',
        });
      }
      if (outcome.kind === 'invalid_data') {
        return reply.code(422).send({
          error: 'Cannot publish: required fields are missing or invalid',
          issues: outcome.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      if (outcome.kind === 'category_required') {
        return reply.code(422).send({
          error:
            'Cannot publish: this content type requires at least one category before going live.',
          code: 'category_required',
          boundCategorySlugs: outcome.boundCategorySlugs,
        });
      }
      if (outcome.content) {
        const transitioned = outcome.content;
        await invalidatePublicContentCache(
          request.log,
          transitioned.tenantId,
          transitioned.contentTypeId,
          transitioned.slug,
        );
        // Status changed — enqueue a reindex so the document's `status`
        // filter is accurate (the public route filters out non-published
        // rows). Worker retries on transient failures. Local alias keeps
        // the narrowed type live through the .catch() closure.
        void producers.searchIndex
          .upsert(transitioned.id, 'transition', request.id)
          .catch((err: unknown) => {
            request.log.warn(
              { err, contentId: transitioned.id },
              'enqueue search-index upsert failed',
            );
          });

        // Reconcile pending scheduled jobs with the new status.
        // - Entering 'scheduled': enqueue a delayed publish job using the
        //   row's publishAt (the transition handler already enforced it's set).
        // - Leaving 'scheduled': cancel any pending publish job.
        // - Entering 'published': if unpublishAt is set, enqueue the unpublish
        //   job; the user may have set the takedown time on the same write.
        // - Leaving 'published': cancel any pending unpublish.
        if (transitioned.status === 'scheduled' && transitioned.publishAt) {
          void producers.schedule
            .publishAt(transitioned.id, transitioned.publishAt, request.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: transitioned.id },
                'enqueue schedule-publish failed',
              );
            });
        } else if (outcome.kind === 'ok' && outcome.from === 'scheduled') {
          void producers.schedule
            .cancelPublish(transitioned.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: transitioned.id },
                'cancel schedule-publish failed',
              );
            });
        }
        if (transitioned.status === 'published' && transitioned.unpublishAt) {
          void producers.schedule
            .unpublishAt(transitioned.id, transitioned.unpublishAt, request.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: transitioned.id },
                'enqueue schedule-unpublish failed',
              );
            });
        } else if (outcome.kind === 'ok' && outcome.from === 'published') {
          void producers.schedule
            .cancelUnpublish(transitioned.id)
            .catch((err: unknown) => {
              request.log.warn(
                { err, contentId: transitioned.id },
                'cancel schedule-unpublish failed',
              );
            });
        }
        // Map the new status to an event name. Webhooks subscribe to specific
        // life-cycle events, not generic "transition" — keeps subscriber
        // filtering coherent (e.g. publish-only integrations).
        const transitionEvent =
          transitioned.status === 'published'
            ? 'content.published'
            : transitioned.status === 'archived'
              ? 'content.unpublished'
              : 'content.transitioned';
        void dispatchEvent(
          request.log,
          transitionEvent,
          {
            id: transitioned.id,
            slug: transitioned.slug,
            status: transitioned.status,
            contentTypeId: transitioned.contentTypeId,
          },
          transitioned.tenantId,
          request.id,
        );

        // Review-flow notifications. Only fire for tenant-scoped content
        // (notifyReviewers needs a tenantId to scope the lookup).
        if (
          outcome.kind === 'ok' &&
          transitioned.tenantId &&
          outcome.from === 'draft' &&
          transitioned.status === 'in_review'
        ) {
          void notifyReviewers({
            log: request.log,
            tenantId: transitioned.tenantId,
            actorId: session.user.id,
            actorDisplayName: session.user.displayName,
            contentId: transitioned.id,
            contentTitle: transitioned.title,
            comment: body.data.comment ?? null,
            reqId: request.id,
          });
        }
        if (
          outcome.kind === 'ok' &&
          outcome.from === 'in_review' &&
          (transitioned.status === 'approved' ||
            transitioned.status === 'published')
        ) {
          void notifyAuthor({
            log: request.log,
            tenantId: transitioned.tenantId,
            authorId: transitioned.authorId,
            actorDisplayName: session.user.displayName,
            kind: 'review_approved',
            contentId: transitioned.id,
            contentTitle: transitioned.title,
            comment: body.data.comment ?? null,
            reqId: request.id,
          });
        }
        if (
          outcome.kind === 'ok' &&
          outcome.from === 'in_review' &&
          transitioned.status === 'draft'
        ) {
          void notifyAuthor({
            log: request.log,
            tenantId: transitioned.tenantId,
            authorId: transitioned.authorId,
            actorDisplayName: session.user.displayName,
            kind: 'review_rejected',
            contentId: transitioned.id,
            contentTitle: transitioned.title,
            comment: body.data.comment ?? null,
            reqId: request.id,
          });
        }
      }
      // GET and PATCH single-row responses carry taxonomyTermIds; transitions
      // must too — the editor's pullFromServer treats a missing field as "no
      // terms", so omitting it here made the next save silently wipe the
      // post's categories/tags after any status change.
      return {
        data: outcome.content
          ? {
              ...outcome.content,
              taxonomyTermIds: await fetchContentTermIds(outcome.content.id),
            }
          : outcome.content,
      };
    },
  );

  // GET /:id/revisions — list revisions for a content row, newest first.
  // Tenant-scoped via a join on content. Append-only, so no pagination
  // until contents accumulate hundreds of revisions in practice.
  fastify.get('/:id/revisions', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const session = getSession(request);

    const [exists] = await db
      .select({ id: schema.content.id })
      .from(schema.content)
      .where(
        and(
          eq(schema.content.id, params.data.id),
          tenantFilter(session.user, schema.content.tenantId),
        ),
      )
      .limit(1);
    if (!exists) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const rows = await db
      .select()
      .from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.contentId, params.data.id))
      .orderBy(desc(schema.contentRevisions.revisionNumber));
    return { data: rows };
  });

  // POST /:id/preview-token — mint a short-lived signed token that lets the
  // editor open this content (including drafts) on the public site via
  // ?preview=<token>. Stateless: rotating PREVIEW_TOKEN_SECRET invalidates
  // everything. 422 when the content type has no public single-item route
  // yet (see preview-routes.ts) so the admin can surface a clear message.
  fastify.post('/:id/preview-token', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const session = getSession(request);

    const [row] = await db
      .select({
        id: schema.content.id,
        slug: schema.content.slug,
        title: schema.content.title,
        tenantId: schema.content.tenantId,
        typeSlug: schema.contentTypes.slug,
        typePreviewPath: schema.contentTypes.previewPath,
      })
      .from(schema.content)
      .innerJoin(
        schema.contentTypes,
        eq(schema.content.contentTypeId, schema.contentTypes.id),
      )
      .where(
        and(
          eq(schema.content.id, params.data.id),
          tenantFilter(session.user, schema.content.tenantId),
        ),
      )
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'Not found' });

    // Primary category slug for the `{category}` permalink token. Separate
    // query so the main row doesn't fan out; mirrors the public route's
    // "first term in the categories taxonomy" rule (public/content.ts).
    const [categoryRow] = await db
      .select({ termSlug: schema.taxonomyTerms.slug })
      .from(schema.contentTaxonomyTerms)
      .innerJoin(
        schema.taxonomyTerms,
        eq(schema.contentTaxonomyTerms.termId, schema.taxonomyTerms.id),
      )
      .innerJoin(
        schema.taxonomies,
        eq(schema.taxonomyTerms.taxonomyId, schema.taxonomies.id),
      )
      .where(
        and(
          eq(schema.contentTaxonomyTerms.contentId, row.id),
          eq(schema.taxonomies.slug, 'categories'),
        ),
      )
      .limit(1);

    const path = buildPreviewPath(
      row.typePreviewPath,
      row.slug,
      categoryRow?.termSlug ?? null,
    );
    if (!path) {
      return reply.code(422).send({ error: 'no_public_route' });
    }

    const { token, expiresAt } = generatePreviewToken(row.id);
    const siteUrl = await resolveSiteUrl(row.tenantId);
    if (!siteUrl) {
      return reply.code(422).send({
        error: 'site_url_not_configured',
        message: 'Set Site URL in Site Settings to enable preview links.',
      });
    }
    const previewUrl = `${siteUrl}${path}?preview=${encodeURIComponent(token)}`;

    await logAudit({
      tenantId: row.tenantId,
      actorId: session.user.id,
      action: 'content.preview_token_issued',
      resourceType: 'content',
      resourceId: row.id,
      afterSnapshot: { title: row.title, slug: row.slug },
      metadata: { typeSlug: row.typeSlug, expiresAt: expiresAt.toISOString() },
      request,
    });

    return {
      data: { previewUrl, expiresAt: expiresAt.toISOString() },
    };
  });

  // POST /:id/duplicate — create a new draft as a copy of an existing row.
  // Copies the body (custom_fields), template, locale, featured/sort, and the
  // category/tag attachments; SEO is intentionally NOT copied (it's per-URL and
  // an editor tailors it before publishing). Slug becomes <slug>-copy[-n], the
  // smallest n that clears the (tenant, type, slug) uniqueness constraint. The
  // copy starts as a draft authored by the caller. Author+ (same as create).
  fastify.post(
    '/:id/duplicate',
    { preHandler: requireAdminRole('author') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const session = getSession(request);

      const [src] = await db
        .select()
        .from(schema.content)
        .where(
          and(
            eq(schema.content.id, params.data.id),
            tenantFilter(session.user, schema.content.tenantId),
          ),
        )
        .limit(1);
      if (!src) return reply.code(404).send({ error: 'Not found' });

      // Probe for a free copy slug within the SAME (tenant, content type),
      // because that's the scope of the uniqueness constraint. 100-attempt cap
      // guards against a pathological loop.
      let copySlug = `${src.slug}-copy`;
      for (let n = 1; n <= 100; n++) {
        const probe = n === 1 ? `${src.slug}-copy` : `${src.slug}-copy-${n}`;
        const [conflict] = await db
          .select({ id: schema.content.id })
          .from(schema.content)
          .where(
            and(
              tenantFilter(session.user, schema.content.tenantId),
              eq(schema.content.contentTypeId, src.contentTypeId),
              eq(schema.content.slug, probe),
            ),
          )
          .limit(1);
        if (!conflict) {
          copySlug = probe;
          break;
        }
        if (n === 100) {
          return reply
            .code(409)
            .send({ error: 'Could not find a free copy slug' });
        }
      }

      const srcTermIds = await fetchContentTermIds(src.id);

      try {
        const copy = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(schema.content)
            .values({
              tenantId: src.tenantId,
              contentTypeId: src.contentTypeId,
              title: `${src.title} (copy)`,
              slug: copySlug,
              status: 'draft',
              authorId: session.user.id,
              customFields: src.customFields,
              templateKey: src.templateKey,
              locale: src.locale,
              featured: src.featured,
              sortOrder: src.sortOrder,
            })
            .returning();
          if (!inserted) return null;

          if (srcTermIds.length > 0) {
            await tx.insert(schema.contentTaxonomyTerms).values(
              srcTermIds.map((termId) => ({
                contentId: inserted.id,
                termId,
              })),
            );
          }

          await logAudit({
            tx,
            tenantId: inserted.tenantId,
            actorId: session.user.id,
            action: 'content.duplicated',
            resourceType: 'content',
            resourceId: inserted.id,
            beforeSnapshot: { sourceId: src.id, sourceSlug: src.slug },
            afterSnapshot: { id: inserted.id, slug: inserted.slug, title: inserted.title },
            request,
          });

          return inserted;
        });

        if (!copy) return reply.code(404).send({ error: 'Not found' });

        // Index the draft so admin search finds it (public search still hides
        // drafts via the status filter). Fire-and-forget — mirrors create.
        void producers.searchIndex
          .upsert(copy.id, 'create', request.id)
          .catch((err: unknown) => {
            request.log.warn(
              { err, contentId: copy.id },
              'enqueue search-index upsert failed',
            );
          });

        return reply.code(201).send({ data: copy });
      } catch (e: unknown) {
        if (isContentUniqueViolation(e)) {
          return reply.code(409).send({
            error: 'A content row with this slug already exists for this type',
          });
        }
        throw e;
      }
    },
  );

  // DELETE /:id — delete content. Schema FKs cascade through revisions,
  // status_transitions, view_events, and content_taxonomy_terms.
  fastify.delete(
    '/:id',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const session = getSession(request);
      const [deleted] = await db
        .delete(schema.content)
        .where(
          and(
            eq(schema.content.id, params.data.id),
            tenantFilter(session.user, schema.content.tenantId),
          ),
        )
        .returning({
          id: schema.content.id,
          tenantId: schema.content.tenantId,
          contentTypeId: schema.content.contentTypeId,
          slug: schema.content.slug,
          title: schema.content.title,
        });
      if (!deleted) {
        return reply.code(404).send({ error: 'Not found' });
      }
      await logAudit({
        tenantId: deleted.tenantId,
        actorId: session.user.id,
        action: 'content.deleted',
        resourceType: 'content',
        resourceId: deleted.id,
        beforeSnapshot: { title: deleted.title, slug: deleted.slug },
        request,
      });
      await invalidatePublicContentCache(
        request.log,
        deleted.tenantId,
        deleted.contentTypeId,
        deleted.slug,
      );
      // Enqueue a Meili delete so search results stop returning a row that
      // no longer exists. search_index_log cascades on content delete, so
      // there's no DB cleanup required here.
      void producers.searchIndex
        .remove(deleted.id, request.id)
        .catch((err: unknown) => {
          request.log.warn(
            { err, contentId: deleted.id },
            'enqueue search-index remove failed',
          );
        });
      // Cancel any pending publish/unpublish jobs — if either fires now,
      // it would error out on a gone content row. Removing the jobs is a
      // small Redis no-op when nothing is queued.
      void producers.schedule
        .cancelPublish(deleted.id)
        .catch((err: unknown) => {
          request.log.warn(
            { err, contentId: deleted.id },
            'cancel schedule-publish failed',
          );
        });
      void producers.schedule
        .cancelUnpublish(deleted.id)
        .catch((err: unknown) => {
          request.log.warn(
            { err, contentId: deleted.id },
            'cancel schedule-unpublish failed',
          );
        });
      void dispatchEvent(
        request.log,
        'content.deleted',
        {
          id: deleted.id,
          slug: deleted.slug,
          contentTypeId: deleted.contentTypeId,
        },
        deleted.tenantId,
        request.id,
      );
      return reply.code(204).send();
    },
  );
};
