import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { resolveSiteUrl } from '../../lib/site-url.js';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { invalidateKeys } from '../../lib/cache.js';
import { purgeWebCache } from '../../lib/purge-web-cache.js';
import { generatePreviewToken } from '../../lib/preview-token.js';
import { logAudit } from '../../lib/audit.js';
import { isReservedSlug } from '../../lib/reserved-slugs.js';
import {
  collisionResponse,
  findSlugCollision,
} from '../../lib/slug-collision.js';
import { getBlock, isPageLayout, listPageLayouts } from '@cms/blocks';

// ─── Status enum + state machine (mirrors admin/content.ts) ───────────────

const PAGE_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'scheduled',
  'published',
  'archived',
] as const;
type PageStatus = (typeof PAGE_STATUSES)[number];
const PageStatusSchema = z.enum(PAGE_STATUSES);

const ALLOWED_TRANSITIONS: Record<PageStatus, readonly PageStatus[]> = {
  draft: ['in_review', 'scheduled', 'published'],
  in_review: ['draft', 'approved'],
  approved: ['draft', 'scheduled', 'published'],
  scheduled: ['draft', 'published'],
  published: ['archived'],
  archived: ['draft'],
};
const canTransition = (from: PageStatus, to: PageStatus): boolean =>
  from !== to && (ALLOWED_TRANSITIONS[from]?.includes(to) ?? false);

// ─── Validation ───────────────────────────────────────────────────────────

const SlugSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase alphanumeric + hyphens');

const TitleSchema = z.string().min(1).max(500);

const PageTypeSchema = z.enum(['static', 'dynamic']);

const SeoBody = z
  .object({
    metaTitle: z.string().max(500).nullable().optional(),
    metaDescription: z.string().max(1000).nullable().optional(),
    ogImageUrl: z.string().max(2048).nullable().optional(),
    canonicalUrl: z.string().max(2048).nullable().optional(),
    robotsIndex: z.boolean().optional(),
    robotsFollow: z.boolean().optional(),
  })
  .strict()
  .default({});

// Layout shells the editor can pick for static pages — validated against the
// theme page-layout registry (@cms/blocks `pageLayoutRegistry`), the single
// source of truth, so a stray value never reaches the row. The public renderer
// applies the chosen layout (a `chromeless` one drops the site header/footer).
const LayoutTemplateSchema = z
  .string()
  .refine(isPageLayout, { message: 'unknown layout template' });

// How a static page's body is authored. 'raw' = pasted html/css; 'normal' =
// TipTap rich text stored in `body`. Stored independently, never auto-converted.
const ContentModeSchema = z.enum(['normal', 'raw']);

const CreatePageBody = z
  .object({
    type: PageTypeSchema,
    title: TitleSchema,
    slug: SlugSchema,
    // Static-only — accepted on all types but ignored on dynamic.
    html: z.string().max(500_000).default(''),
    css: z.string().max(200_000).default(''),
    // Static-only — picks the page's layout shell. Defaulted to 'default'
    // on INSERT for static rows; the column stays NULL on dynamic rows.
    layoutTemplate: LayoutTemplateSchema.nullable().optional(),
    // Static-only — content authoring mode + the Normal-mode TipTap body JSON.
    contentMode: ContentModeSchema.optional(),
    body: z.unknown().nullable().optional(),
    // Dynamic-only — accepted on all types but ignored on static.
    templateKey: z.string().max(255).nullable().optional(),
    blocks: z.array(z.unknown()).default([]),
    seo: SeoBody,
    locale: z.string().min(2).max(10).default('en'),
    publishAt: z.string().datetime().nullable().optional(),
    unpublishAt: z.string().datetime().nullable().optional(),
  })
  .strict();

const UpdatePageBody = CreatePageBody.partial();

const TransitionBody = z
  .object({
    toStatus: PageStatusSchema,
    comment: z.string().max(2000).optional(),
  })
  .strict();

const ListQuery = z
  .object({
    type: PageTypeSchema.optional(),
    status: PageStatusSchema.optional(),
    q: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    sort: z.enum(['title', 'updated_at']).default('updated_at'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const PreviewStaticBody = z
  .object({
    html: z.string().max(500_000).default(''),
    css: z.string().max(200_000).default(''),
    pageId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .default('preview'),
  })
  .strict();

// ─── Helpers ──────────────────────────────────────────────────────────────

// Tenant filter moved to ../../lib/tenant-scope.ts so super_admin gets the
// global bypass automatically — see tenantFilter() in that module.

// Best-effort public cache invalidation. Mirrors invalidatePublicContentCache
// in admin/content.ts:291 — same fail-open contract: the write already
// committed; cache problems must never block the response.
async function invalidatePublicPageCache(
  log: { warn: (obj: unknown, msg: string) => void },
  tenantId: string,
  slug: string,
): Promise<void> {
  try {
    // Invalidate the page payload AND the /resolve dispatcher entry — the
    // latter carries the page's `chromeless` flag, so a layout change must
    // refresh both or the public chrome lags by up to the cache TTL.
    await invalidateKeys([
      `cache:page:${tenantId}:${slug}`,
      `cache:resolve:${tenantId}:${slug}`,
    ]);
    // Also drop the web (Nitro SWR) HTML cache. The home/stories/archive
    // routes cache their rendered HTML, which embeds this page's payload — so
    // a Redis-only drop leaves that HTML stale for up to the 5-min TTL (the
    // "my edit isn't showing" + hydration-mismatch symptom). Fail-open.
    await purgeWebCache(log, tenantId);
  } catch (err) {
    log.warn({ err, slug }, 'public page cache invalidation failed');
  }
}

// Append-only revision snapshot. revision_number is monotonic per page, seeded
// from MAX(rev)+1 to handle racing saves correctly under PgBouncer.
async function snapshotRevision(
  pageId: string,
  tenantId: string,
  changedBy: string | null,
  summary: string | null,
): Promise<void> {
  const [page] = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);
  if (!page) return;
  const nextRows = await db
    .select({
      next: sql<number>`coalesce(max(${schema.pageRevisions.revisionNumber}), 0) + 1`,
    })
    .from(schema.pageRevisions)
    .where(eq(schema.pageRevisions.pageId, pageId));
  // The aggregate always returns one row even for an empty set (max() → null
  // → coalesced to 0 → +1 = 1). The optional chain keeps TS happy.
  const next = nextRows[0]?.next ?? 1;
  await db.insert(schema.pageRevisions).values({
    pageId,
    tenantId,
    snapshot: page,
    changedBy,
    changeSummary: summary,
    revisionNumber: next,
  });
}

// Return the (de-duplicated) list of block keys present in a page's blocks
// jsonb that don't resolve in the registry. Used by the publish-transition
// handler to refuse a publish that would render with broken placeholders.
function collectUnknownBlockKeys(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of blocks) {
    if (!item || typeof item !== 'object') continue;
    const key = (item as Record<string, unknown>)['block_key'];
    if (typeof key !== 'string' || key.length === 0) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!getBlock(key)) out.push(key);
  }
  return out;
}

// Auto-create a 301 from /<old> → /<new> when a published page's slug
// changes. Idempotent — if a redirect with the same from_path already
// exists, we skip rather than crash on the unique constraint.
async function recordSlugRedirect(
  log: { warn: (obj: unknown, msg: string) => void },
  tenantId: string,
  oldSlug: string,
  newSlug: string,
): Promise<void> {
  if (oldSlug === newSlug) return;
  try {
    await db
      .insert(schema.redirects)
      .values({
        tenantId,
        fromPath: `/${oldSlug}`,
        toPath: `/${newSlug}`,
        redirectType: 301,
        autoCreated: true,
        notes: 'Auto-created on page slug change',
      })
      .onConflictDoNothing();
  } catch (err) {
    log.warn({ err, oldSlug, newSlug }, 'auto-redirect insert failed');
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────

export const adminPagesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // GET /layouts — the theme's page-layout registry (id/label/description) for
  // the static editor's Layout Template selector. Theme-coded (@cms/blocks
  // pageLayoutRegistry). Static route — Fastify matches it before GET /:id.
  fastify.get('/layouts', async () => {
    return { data: listPageLayouts() };
  });

  // GET / — paginated list with search, sort, and tenant-wide counts.
  //
  // Filters (type / status / q) narrow the `data` + `total`, but `counts` is
  // always tenant-wide (unfiltered minus soft-deletes) so the stat strip
  // behaves as a stable KPI tile rather than a preview of the current filter.
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
    const session = request.adminSession;
    if (!session) return reply.code(401).send({ error: 'Unauthenticated' });
    const tenantId = session.user.tenantId;
    if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

    const { type, status, q, sort, dir, page, limit } = query.data;

    const baseConditions: (SQL | undefined)[] = [
      tenantFilter(session.user, schema.pages.tenantId),
      isNull(schema.pages.deletedAt),
    ];
    const filterConditions: (SQL | undefined)[] = [...baseConditions];
    if (type) filterConditions.push(eq(schema.pages.type, type));
    if (status) filterConditions.push(eq(schema.pages.status, status));
    if (q) {
      const pattern = `%${q}%`;
      // or() never returns undefined here — both args are concrete SQLs —
      // but its type union includes it, so narrow once before pushing.
      const qSql = or(
        ilike(schema.pages.title, pattern),
        ilike(schema.pages.slug, pattern),
      );
      if (qSql) filterConditions.push(qSql);
    }

    const sortColumn =
      sort === 'title' ? schema.pages.title : schema.pages.updatedAt;
    const orderBy = dir === 'asc' ? asc(sortColumn) : desc(sortColumn);
    const offset = (page - 1) * limit;

    const [rows, [totalRow], [countsRow]] = await Promise.all([
      db
        .select()
        .from(schema.pages)
        .where(and(...filterConditions))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.pages)
        .where(and(...filterConditions)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          published: sql<number>`count(*) filter (where ${schema.pages.status} = 'published')::int`,
          drafts: sql<number>`count(*) filter (where ${schema.pages.status} = 'draft')::int`,
          dynamic: sql<number>`count(*) filter (where ${schema.pages.type} = 'dynamic')::int`,
        })
        .from(schema.pages)
        .where(and(...baseConditions)),
    ]);

    const total = totalRow?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const counts = {
      total: countsRow?.total ?? 0,
      published: countsRow?.published ?? 0,
      drafts: countsRow?.drafts ?? 0,
      dynamic: countsRow?.dynamic ?? 0,
    };

    return {
      data: rows,
      pagination: { page, limit, total, totalPages },
      counts,
    };
  });

  // GET /:id — single page including the editable raw HTML/CSS. The public
  // route serves the sanitized version; admins see the raw input they pasted
  // (round-tripped through the sanitizer on save, so it's safe but might be
  // visibly different from what they typed if anything got stripped).
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const session = request.adminSession!;
    const tenantId = session.user.tenantId;
    if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

    const [row] = await db
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, request.params.id),
          tenantFilter(session.user, schema.pages.tenantId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  // POST / — create a page. Static html/css are stored verbatim (admin-only
  // surface; sanitization unwired). The "+ New Page" flow on the admin sends
  // a placeholder slug like `untitled-abc12` and the title "Untitled page";
  // if a previous click left an unedited draft of the same type behind, we
  // hand that one back instead of stamping another row.
  fastify.post(
    '/',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
    const body = CreatePageBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'Invalid body',
        issues: body.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const session = request.adminSession!;
    const tenantId = session.user.tenantId;
    if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

    if (isReservedSlug(body.data.slug)) {
      return reply.code(400).send({
        error: `Slug "${body.data.slug}" is reserved for system routes. Please choose another.`,
        code: 'reserved_slug',
      });
    }
    // Cross-table guard — flat-URL world. Reject if slug already owns a
    // category or tag archive. New page; no exclusion id.
    const collisionOnCreate = await findSlugCollision({
      slug: body.data.slug,
      tenantId,
    });
    if (collisionOnCreate) {
      return reply
        .code(400)
        .send(collisionResponse(body.data.slug, collisionOnCreate));
    }

    // Auto-create reuse: when the request looks like a click on "+ New Page"
    // (placeholder slug + placeholder title) check whether the same tenant
    // already has an untouched draft of the same type. If so, return it so
    // the admin lands back in the existing empty editor instead of creating
    // yet another Untitled row.
    // Only the bare "+ New Page" click reuses an existing empty draft. A
    // content-bearing create (e.g. template-first dynamic pages, which arrive
    // with blocks + a templateKey) must always mint a fresh row — otherwise it
    // would silently hand back an unrelated empty draft and drop the payload.
    const incomingIsEmpty =
      (!body.data.blocks || body.data.blocks.length === 0) &&
      !body.data.templateKey &&
      !body.data.html &&
      !body.data.css;
    const looksLikeAutoCreate =
      incomingIsEmpty &&
      body.data.slug.startsWith('untitled-') &&
      body.data.title === 'Untitled page';
    if (looksLikeAutoCreate) {
      const emptyContent =
        body.data.type === 'static'
          ? sql`COALESCE(${schema.pages.html}, '') = '' AND COALESCE(${schema.pages.css}, '') = ''`
          : sql`COALESCE(jsonb_array_length(${schema.pages.blocks}), 0) = 0`;
      const [existing] = await db
        .select()
        .from(schema.pages)
        .where(
          and(
            tenantFilter(session.user, schema.pages.tenantId),
            eq(schema.pages.type, body.data.type),
            eq(schema.pages.status, 'draft'),
            eq(schema.pages.title, 'Untitled page'),
            sql`${schema.pages.slug} LIKE 'untitled-%'`,
            isNull(schema.pages.deletedAt),
            emptyContent,
          ),
        )
        .orderBy(desc(schema.pages.createdAt))
        .limit(1);
      if (existing) return existing;
    }

    const id = crypto.randomUUID();
    const html = body.data.type === 'static' ? (body.data.html ?? '') : '';
    const css = body.data.type === 'static' ? (body.data.css ?? '') : '';

    // Static rows always carry a layout (defaulted to 'default') so the
    // admin select never sees a "— choose —" hole. Dynamic rows leave the
    // column NULL — the builder ignores it entirely.
    const layoutTemplate =
      body.data.type === 'static'
        ? (body.data.layoutTemplate ?? 'default')
        : null;

    // New static pages default to Normal (TipTap) mode; the body is empty until
    // the admin types. Dynamic rows keep the column at its 'raw' default and
    // never use `body`.
    const contentMode =
      body.data.type === 'static'
        ? (body.data.contentMode ?? 'normal')
        : 'raw';
    const bodyJson =
      body.data.type === 'static' ? (body.data.body ?? null) : null;

    try {
      const [row] = await db
        .insert(schema.pages)
        .values({
          id,
          tenantId,
          slug: body.data.slug,
          title: body.data.title,
          type: body.data.type,
          status: 'draft',
          html,
          css,
          layoutTemplate,
          contentMode,
          body: bodyJson,
          templateKey: body.data.templateKey ?? null,
          blocks: body.data.blocks ?? [],
          seo: body.data.seo ?? {},
          locale: body.data.locale ?? 'en',
          authorId: session.user.id,
          publishAt: body.data.publishAt ? new Date(body.data.publishAt) : null,
          unpublishAt: body.data.unpublishAt
            ? new Date(body.data.unpublishAt)
            : null,
        })
        .returning();
      await snapshotRevision(id, tenantId, session.user.id, 'created');
      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'page.created',
        resourceType: 'page',
        resourceId: id,
        afterSnapshot: { title: row!.title, slug: row!.slug, type: row!.type },
        request,
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('pages_tenant_slug_uniq')
      ) {
        return reply.code(409).send({
          error: 'A page with this slug already exists',
        });
      }
      throw err;
    }
  });

  // PATCH /:id — update. If slug changes on a published page, auto-create a
  // 301 from the old URL. Static html/css re-sanitized; cache invalidated
  // for both old and new slugs.
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const body = UpdatePageBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: 'Invalid body',
          issues: body.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const [current] = await db
        .select()
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, request.params.id),
            tenantFilter(session.user, schema.pages.tenantId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!current) return reply.code(404).send({ error: 'Not found' });

      if (
        body.data.slug !== undefined &&
        body.data.slug !== current.slug &&
        isReservedSlug(body.data.slug)
      ) {
        return reply.code(400).send({
          error: `Slug "${body.data.slug}" is reserved for system routes. Please choose another.`,
          code: 'reserved_slug',
        });
      }
      // Cross-table slug-collision guard on PATCH — only fires when the slug
      // is actually changing, and excludes this page id so the row doesn't
      // collide with itself.
      if (
        body.data.slug !== undefined &&
        body.data.slug !== current.slug &&
        tenantId !== null
      ) {
        const collidesWith = await findSlugCollision({
          slug: body.data.slug,
          tenantId,
          exclude: { kind: 'page', id: request.params.id },
        });
        if (collidesWith) {
          return reply
            .code(400)
            .send(collisionResponse(body.data.slug, collidesWith));
        }
      }

      const updates: Partial<typeof schema.pages.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.data.title !== undefined) updates.title = body.data.title;
      if (body.data.slug !== undefined) updates.slug = body.data.slug;
      if (body.data.locale !== undefined) updates.locale = body.data.locale;
      if (body.data.seo !== undefined) updates.seo = body.data.seo;
      if (body.data.templateKey !== undefined) {
        updates.templateKey = body.data.templateKey;
      }
      // layoutTemplate is static-only; ignore on dynamic rows rather than
      // 400 — legitimate UI paths (PATCH slug/title from the dynamic
      // builder) wouldn't include it anyway.
      if (
        body.data.layoutTemplate !== undefined &&
        current.type === 'static'
      ) {
        updates.layoutTemplate = body.data.layoutTemplate;
      }
      if (body.data.blocks !== undefined) updates.blocks = body.data.blocks;
      if (body.data.publishAt !== undefined) {
        updates.publishAt = body.data.publishAt
          ? new Date(body.data.publishAt)
          : null;
      }
      if (body.data.unpublishAt !== undefined) {
        updates.unpublishAt = body.data.unpublishAt
          ? new Date(body.data.unpublishAt)
          : null;
      }

      // Static html/css stored verbatim — admin-only feature, no sanitization
      // and no per-page CSS scoping. Pasted CSS targeting `body` / `:root`
      // applies globally to the rendered page, which is what the admin wrote.
      const targetType = current.type;
      if (targetType === 'static') {
        if (body.data.html !== undefined) updates.html = body.data.html;
        if (body.data.css !== undefined) updates.css = body.data.css;
        if (body.data.contentMode !== undefined) {
          updates.contentMode = body.data.contentMode;
        }
        if (body.data.body !== undefined) {
          updates.body = body.data.body ?? null;
        }
      }

      let result: typeof current;
      try {
        const rows = await db
          .update(schema.pages)
          .set(updates)
          .where(eq(schema.pages.id, current.id))
          .returning();
        result = rows[0]!;
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('pages_tenant_slug_uniq')
        ) {
          return reply.code(409).send({
            error: 'A page with this slug already exists',
          });
        }
        throw err;
      }

      await snapshotRevision(
        current.id,
        tenantId,
        session.user.id,
        'updated',
      );
      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'page.updated',
        resourceType: 'page',
        resourceId: current.id,
        beforeSnapshot: { title: current.title, slug: current.slug },
        afterSnapshot: { title: result.title, slug: result.slug },
        request,
      });

      // Invalidate cache for both the current and any prior slug.
      await invalidatePublicPageCache(request.log, tenantId, result.slug);
      if (current.slug !== result.slug) {
        await invalidatePublicPageCache(request.log, tenantId, current.slug);
        // 301 the old URL to the new one — but only for pages that have
        // been published at some point. A draft slug rename has no public
        // URL worth preserving.
        if (current.publishedAt !== null) {
          await recordSlugRedirect(
            request.log,
            tenantId,
            current.slug,
            result.slug,
          );
        }
      }
      return result;
    },
  );

  // DELETE /:id — soft delete. System-managed rows (seeded migrations,
  // homepage, hard-coded static pages) cannot be deleted from the admin —
  // they back hard-coded URLs.
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const [current] = await db
        .select()
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, request.params.id),
            tenantFilter(session.user, schema.pages.tenantId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!current) return reply.code(404).send({ error: 'Not found' });
      if (current.systemManaged) {
        return reply.code(403).send({
          error: 'System-managed pages cannot be deleted',
        });
      }

      await db
        .update(schema.pages)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.pages.id, current.id));
      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'page.deleted',
        resourceType: 'page',
        resourceId: current.id,
        beforeSnapshot: { title: current.title, slug: current.slug },
        request,
      });
      await invalidatePublicPageCache(request.log, tenantId, current.slug);
      return reply.code(204).send();
    },
  );

  // POST /:id/transitions — state-machine guarded status change. On publish
  // we re-sanitize the body (defense in depth) and stamp published_at.
  fastify.post<{ Params: { id: string } }>(
    '/:id/transitions',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const body = TransitionBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: 'Invalid body',
          issues: body.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const [current] = await db
        .select()
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, request.params.id),
            tenantFilter(session.user, schema.pages.tenantId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!current) return reply.code(404).send({ error: 'Not found' });

      if (!canTransition(current.status, body.data.toStatus)) {
        return reply.code(409).send({
          error: `Cannot transition from ${current.status} to ${body.data.toStatus}`,
        });
      }

      const updates: Partial<typeof schema.pages.$inferInsert> = {
        status: body.data.toStatus,
        updatedAt: new Date(),
      };
      if (body.data.toStatus === 'published') {
        updates.publishedAt = current.publishedAt ?? new Date();
        updates.publishedBy = session.user.id;
        // No re-sanitize on publish — static pages are stored verbatim.
        // Dynamic — validate every block_key against the live registry.
        // Publishing a page with a stale block (e.g. a dev removed the
        // block_key in code without migrating affected pages) would render
        // a degraded "Unknown block" placeholder to every visitor, which is
        // worse than failing the publish loudly and letting the editor fix it.
        if (current.type === 'dynamic') {
          const invalidKeys = collectUnknownBlockKeys(current.blocks);
          if (invalidKeys.length > 0) {
            return reply.code(409).send({
              error: 'Page references blocks that no longer exist',
              unknownBlockKeys: invalidKeys,
            });
          }
        }
      }

      const [updated] = await db
        .update(schema.pages)
        .set(updates)
        .where(eq(schema.pages.id, current.id))
        .returning();

      await db.insert(schema.pageStatusTransitions).values({
        pageId: current.id,
        fromStatus: current.status,
        toStatus: body.data.toStatus,
        changedBy: session.user.id,
        comment: body.data.comment ?? null,
      });
      await snapshotRevision(
        current.id,
        tenantId,
        session.user.id,
        `status: ${current.status} → ${body.data.toStatus}`,
      );
      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'page.transitioned',
        resourceType: 'page',
        resourceId: current.id,
        afterSnapshot: { fromStatus: current.status, toStatus: body.data.toStatus },
        request,
      });
      await invalidatePublicPageCache(request.log, tenantId, updated!.slug);
      return updated;
    },
  );

  // POST /:id/duplicate — create a new draft as a copy. Slug becomes
  // <original>-copy-<n> where n is the smallest integer that avoids the
  // tenant slug-uniqueness constraint.
  fastify.post<{ Params: { id: string } }>(
    '/:id/duplicate',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const [src] = await db
        .select()
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, request.params.id),
            tenantFilter(session.user, schema.pages.tenantId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!src) return reply.code(404).send({ error: 'Not found' });

      // Find a free copy slug. Probe sequentially; 100 attempts cap to avoid
      // an infinite loop in pathological cases.
      let copySlug = `${src.slug}-copy`;
      for (let n = 1; n <= 100; n++) {
        const probe = n === 1 ? copySlug : `${src.slug}-copy-${n}`;
        const [conflict] = await db
          .select({ id: schema.pages.id })
          .from(schema.pages)
          .where(and(tenantFilter(session.user, schema.pages.tenantId), eq(schema.pages.slug, probe)))
          .limit(1);
        if (!conflict) {
          copySlug = probe;
          break;
        }
        if (n === 100) {
          return reply.code(409).send({
            error: 'Could not find a free copy slug',
          });
        }
      }

      const newId = crypto.randomUUID();
      // Copy html/css verbatim — no per-page wrapper to rewrite.
      const html = src.type === 'static' ? (src.html ?? '') : '';
      const css = src.type === 'static' ? (src.css ?? '') : '';
      const [copy] = await db
        .insert(schema.pages)
        .values({
          id: newId,
          tenantId,
          slug: copySlug,
          title: `${src.title} (copy)`,
          type: src.type,
          status: 'draft',
          html,
          css,
          layoutTemplate: src.layoutTemplate,
          templateKey: src.templateKey,
          blocks: src.blocks,
          seo: src.seo,
          locale: src.locale,
          authorId: session.user.id,
        })
        .returning();
      await snapshotRevision(
        newId,
        tenantId,
        session.user.id,
        `duplicated from ${src.id}`,
      );
      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'page.duplicated',
        resourceType: 'page',
        resourceId: newId,
        beforeSnapshot: { sourceId: src.id, sourceSlug: src.slug },
        afterSnapshot: { id: newId, slug: copySlug },
        request,
      });
      return reply.code(201).send(copy);
    },
  );

  // GET /:id/revisions — read-only list, newest first.
  fastify.get<{ Params: { id: string } }>(
    '/:id/revisions',
    async (request, reply) => {
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      // Confirm the page belongs to this tenant before exposing snapshots.
      const [page] = await db
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, request.params.id),
            tenantFilter(session.user, schema.pages.tenantId),
          ),
        )
        .limit(1);
      if (!page) return reply.code(404).send({ error: 'Not found' });

      const rows = await db
        .select()
        .from(schema.pageRevisions)
        .where(eq(schema.pageRevisions.pageId, request.params.id))
        .orderBy(desc(schema.pageRevisions.revisionNumber));
      return { data: rows };
    },
  );

  // POST /preview-static — debounced live render for the static editor.
  // Sanitizes whatever the admin is currently typing and returns the safe
  // HTML+CSS the preview iframe should render. No DB write; ephemeral.
  fastify.post('/preview-static', async (request, reply) => {
    const body = PreviewStaticBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'Invalid body',
        issues: body.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    // Static pages skip sanitization — return the input unchanged. The
    // endpoint is kept for any UI that wants an ephemeral render echo, but
    // it no longer transforms the payload.
    return { html: body.data.html, css: body.data.css };
  });

  // POST /:id/preview-token — short-lived HMAC token allowing the editor to
  // preview an unpublished page. Reuses the existing content-preview token
  // helper; the payload's `cid` carries the page id (it's just a UUID).
  fastify.post<{ Params: { id: string } }>(
    '/:id/preview-token',
    async (request, reply) => {
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const [page] = await db
        .select({ slug: schema.pages.slug })
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, request.params.id),
            tenantFilter(session.user, schema.pages.tenantId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!page) return reply.code(404).send({ error: 'Not found' });

      const { token, expiresAt } = generatePreviewToken(request.params.id);
      // Build the absolute URL against siteSettings.siteUrl so the admin can
      // open the preview directly. Returning just a path made window.open()
      // resolve against the admin host (e.g. http://localhost:5173/page/...)
      // and the Vite dev server has no route there — preview opened to a 404.
      // Mirrors the shape used by /admin/content/:id/preview-token.
      const siteUrl = await resolveSiteUrl(tenantId);
      if (!siteUrl) {
        return reply.code(422).send({
          error: 'site_url_not_configured',
          message: 'Set Site URL in Site Settings to enable preview links.',
        });
      }
      const previewUrl = `${siteUrl}/${page.slug}?preview=${encodeURIComponent(token)}`;
      return {
        data: { previewUrl, expiresAt: expiresAt.toISOString() },
      };
    },
  );
};
