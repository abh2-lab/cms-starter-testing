import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, exists, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, isUndefinedTableError, schema } from '@cms/db';
import { getBlock, PageBlockInstanceSchema } from '@cms/blocks';
import { THEME_ROUTES } from '../../lib/theme-routes.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { logAudit } from '../../lib/audit.js';
import { invalidateKeys, invalidatePattern } from '../../lib/cache.js';
import { instancesFromTemplate } from '../../lib/compose-blocks.js';
import { defaultsFor } from '../../lib/block-defaults.js';
import { PUBLISHED_VISIBILITY } from '../../lib/block-context.js';
import { generateThemePreviewToken } from '../../lib/preview-token.js';
import { resolveSiteUrl } from '../../lib/site-url.js';
import { purgeWebCache } from '../../lib/purge-web-cache.js';
import {
  BLOCK_OVERRIDE_KIND,
  blockOverrideKey,
  findThemeEntry,
  listThemeEntries,
  templateVersion,
  type ThemeEntry,
} from '../../lib/theme-overrides.js';

// Admin theme routes.
//
// /routes — read-only manifest of the active theme's code-defined routes
// (Nuxt page files with no `pages` row). Backs the "Theme & system routes"
// section on the admin Pages screen. Static code-shipped list — no DB.
//
// /structure + /overrides/* — the FSE structure editor's API (theme engine
// v2.0, super_admin + admin only): list every overridable template/part with
// its customization state, save draft override trees, publish/discard/reset
// them (binary keep/reset — never a merge), and keep a small publish-time
// revision history with restore-to-draft. Resolution everywhere else is
// DB override → code default (see ../../lib/theme-overrides.ts).

const KeyParam = z.object({
  key: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z][a-z0-9-]*$/),
});

// A stored override tree: top-level block instances (recursive children
// validated by PageBlockInstanceSchema). The composer's runtime caps guard
// depth/size at render; this guards the write path.
const SaveDraftBody = z
  .object({
    blocks: z.array(PageBlockInstanceSchema).max(200),
  })
  .strict();

// Per-block default override (theme engine v2 Phase 5): just the one block's
// edited fields (copy) + options (sources). Stored as a single instance.
const BlockDefaultsBody = z
  .object({
    fields: z.record(z.string(), z.unknown()).default({}),
    options: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const RevisionParams = KeyParam.extend({
  n: z.coerce.number().int().min(1),
});

interface OverrideFlags {
  customized: boolean;
  hasDraft: boolean;
  updateAvailable: boolean;
}

function overrideFlags(
  entry: ThemeEntry,
  row: typeof schema.themeOverrides.$inferSelect | null,
): OverrideFlags {
  return {
    customized: !!row?.publishedBlocks,
    hasDraft: !!row?.draftBlocks,
    updateAvailable:
      !!row?.publishedBlocks &&
      templateVersion(entry.meta) > (row?.baseVersion ?? 1),
  };
}

// Best-effort public cache invalidation after a publish/reset — which
// template changed decides which cached payloads embed it. Fail-open like
// every other invalidation helper: the write already committed.
async function invalidateThemeCaches(
  log: { warn: (obj: unknown, msg: string) => void },
  tenantId: string,
  entry: ThemeEntry,
): Promise<void> {
  try {
    if (entry.kind === 'part') {
      await invalidateKeys([`cache:part:${tenantId}:${entry.meta.key}`]);
      return;
    }
    if (entry.meta.role === 'single') {
      // The single template composes inside EVERY content detail payload.
      await invalidatePattern(`cache:content:${tenantId}:*`);
      return;
    }
    if (
      entry.meta.role === 'search' ||
      entry.meta.role === '404' ||
      entry.meta.role === 'authors' ||
      entry.meta.role === 'contact'
    ) {
      // System-page templates (theme engine v2 Phase 4) compose into their own
      // /views/system/:role payload, keyed by role 1:1 — so a single targeted
      // delete is enough (the archive fallback below would never match it).
      await invalidateKeys([`cache:view:system:${tenantId}:${entry.meta.role}`]);
      return;
    }
    // Archive templates compose inside the archive view payloads.
    await invalidatePattern(`cache:view:archive:${tenantId}:*`);
  } catch (err) {
    log.warn(
      { err, key: entry.meta.key },
      'theme override cache invalidation failed',
    );
  }
}

// Append-only revision snapshot of the JUST-PUBLISHED state. revision_number
// is monotonic per override, seeded from MAX(rev)+1 (same PgBouncer-safe
// pattern as page revisions).
async function snapshotOverrideRevision(
  overrideId: string,
  tenantId: string,
  changedBy: string | null,
  summary: string | null,
): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.themeOverrides)
    .where(eq(schema.themeOverrides.id, overrideId))
    .limit(1);
  if (!row) return;
  const nextRows = await db
    .select({
      next: sql<number>`coalesce(max(${schema.themeOverrideRevisions.revisionNumber}), 0) + 1`,
    })
    .from(schema.themeOverrideRevisions)
    .where(eq(schema.themeOverrideRevisions.overrideId, overrideId));
  const next = nextRows[0]?.next ?? 1;
  await db.insert(schema.themeOverrideRevisions).values({
    overrideId,
    tenantId,
    snapshot: {
      templateKey: row.templateKey,
      kind: row.kind,
      baseVersion: row.baseVersion,
      blocks: row.publishedBlocks,
    },
    changedBy,
    changeSummary: summary,
    revisionNumber: next,
  });
}

// Pick a REPRESENTATIVE public path that renders the given template/part —
// the iframe the structure editor reloads after each draft save. Article
// paths serve the article-shaped entries (the layout parts render on every
// page, so the article is the richest canvas); the archive entries get a
// live category/tag URL. All of these are root-resolver routes the prod
// Nuxt config does NOT SWR-cache, so a draft render can never be cached
// server-side. Returns null when the install has no content to stand on.
async function representativePreviewPath(
  tenantId: string,
  entry: ThemeEntry,
): Promise<string | null> {
  const key = entry.meta.key;

  // Parts (header/footer/sidebar) preview IN ISOLATION — a bare page that
  // renders just that part, no surrounding site chrome. Editing the header
  // should show only the header, not a whole article wrapped around it.
  if (entry.kind === 'part') {
    return `/preview/part/${encodeURIComponent(key)}`;
  }

  // System pages (theme engine v2 Phase 4) render at fixed routes that don't
  // depend on any content, so they preview even on a fresh install. The editor
  // appends ?theme_preview, which each page forwards to its compose fetch.
  if (key === 'template-search') return '/search';
  if (key === 'template-authors') return '/authors';
  if (key === 'template-contact') return '/contact';
  // Any unmatched URL renders the theme's error.vue (the 404 template); a
  // dedicated sentinel path keeps it obvious and collision-free.
  if (key === 'template-404') return '/_preview-404-not-found';

  // Latest visible article (+ its terms) anchors most preview targets.
  const latestArticle = async (
    tagOnly: boolean,
  ): Promise<{ slug: string; category: string | null; tag: string | null } | null> => {
    const hasTagFilter = tagOnly
      ? exists(
          db
            .select({ one: sql`1` })
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
                eq(schema.contentTaxonomyTerms.contentId, schema.content.id),
                eq(schema.taxonomies.slug, 'tags'),
              ),
            ),
        )
      : undefined;
    const [row] = await db
      .select({ id: schema.content.id, slug: schema.content.slug })
      .from(schema.content)
      .innerJoin(
        schema.contentTypes,
        eq(schema.content.contentTypeId, schema.contentTypes.id),
      )
      .where(
        and(
          eq(schema.content.tenantId, tenantId),
          eq(schema.contentTypes.slug, 'article'),
          PUBLISHED_VISIBILITY(),
          hasTagFilter,
        ),
      )
      .orderBy(
        sql`COALESCE(${schema.content.publishAt}, ${schema.content.publishedAt}) DESC NULLS LAST`,
        desc(schema.content.id),
      )
      .limit(1);
    if (!row) return null;
    const terms = await db
      .select({
        termSlug: schema.taxonomyTerms.slug,
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
    return {
      slug: row.slug,
      category:
        terms.find((t) => t.taxonomySlug === 'categories')?.termSlug ?? null,
      tag: terms.find((t) => t.taxonomySlug === 'tags')?.termSlug ?? null,
    };
  };

  if (key === 'archive-tag') {
    const a = await latestArticle(true);
    return a?.tag ? `/${a.tag}` : null;
  }
  if (key === 'archive-category' || key === 'archive-default') {
    const a = await latestArticle(false);
    return a?.category ? `/${a.category}` : null;
  }
  // single-article + the layout parts (header/footer/article-sidebar): the
  // article page exercises all of them at once.
  const a = await latestArticle(false);
  if (!a) return null;
  return `/${a.category ?? 'uncategorized'}/${a.slug}`;
}

// Active-theme identity for the Theme Settings "Active Theme" card. Static —
// themes are installed by the developer, not switchable from the admin. Bump
// the version when the theme's structure ships a breaking change.
const THEME_META = {
  name: 'Default',
  version: '1.0.0',
  description:
    'Clean news layout with dynamic pages, article archives, and full-site editing.',
} as const;

export const adminThemeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  fastify.get('/routes', async () => {
    return { data: THEME_ROUTES };
  });

  fastify.get(
    '/meta',
    { preHandler: requireAdminRole('admin') },
    async () => {
      return { data: THEME_META };
    },
  );

  // ─── Structure list ──────────────────────────────────────────────────────

  fastify.get(
    '/structure',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const session = request.adminSession;
      if (!session) return reply.code(401).send({ error: 'Unauthenticated' });
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entries = listThemeEntries();
      // Fail-open on a missing table (migration 0023 pending): the list still
      // renders — everything reads as a pure code default until migrated.
      let rows: Array<typeof schema.themeOverrides.$inferSelect> = [];
      try {
        rows = await db
          .select()
          .from(schema.themeOverrides)
          .where(eq(schema.themeOverrides.tenantId, tenantId));
      } catch (err) {
        if (!isUndefinedTableError(err, 'theme_overrides')) throw err;
      }
      const byKey = new Map(rows.map((r) => [r.templateKey, r]));

      // Resolve "last edited by" display names for the customized rows in one
      // batched lookup (the Theme Settings table shows who touched each override).
      const editorIds = Array.from(
        new Set(rows.map((r) => r.updatedBy).filter((x): x is string => !!x)),
      );
      const editorNames = new Map<string, string>();
      if (editorIds.length > 0) {
        const us = await db
          .select({
            id: schema.adminUsers.id,
            name: schema.adminUsers.displayName,
          })
          .from(schema.adminUsers)
          .where(inArray(schema.adminUsers.id, editorIds));
        for (const u of us) editorNames.set(u.id, u.name);
      }

      return {
        data: entries.map((entry) => {
          const row = byKey.get(entry.meta.key) ?? null;
          const lastEditedBy =
            row && row.updatedBy
              ? {
                  name: editorNames.get(row.updatedBy) ?? null,
                  at: row.updatedAt?.toISOString() ?? null,
                }
              : null;
          return {
            key: entry.meta.key,
            kind: entry.kind,
            role: entry.meta.role ?? null,
            name: entry.meta.name,
            description: entry.meta.description ?? null,
            version: templateVersion(entry.meta),
            baseVersion: row?.baseVersion ?? null,
            updatedAt: row?.updatedAt?.toISOString() ?? null,
            publishedAt: row?.publishedAt?.toISOString() ?? null,
            lastEditedBy,
            ...overrideFlags(entry, row),
          };
        }),
      };
    },
  );

  // ─── Override detail (the editor payload) ───────────────────────────────

  fastify.get<{ Params: { key: string } }>(
    '/overrides/:key',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key' });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      // Fail-open on a missing table (migration 0023 pending) — the editor
      // opens on the code default; saving will surface the real error.
      let row: typeof schema.themeOverrides.$inferSelect | undefined;
      try {
        [row] = await db
          .select()
          .from(schema.themeOverrides)
          .where(
            and(
              eq(schema.themeOverrides.tenantId, tenantId),
              eq(schema.themeOverrides.templateKey, entry.meta.key),
            ),
          )
          .limit(1);
      } catch (err) {
        if (!isUndefinedTableError(err, 'theme_overrides')) throw err;
      }

      return {
        data: {
          key: entry.meta.key,
          kind: entry.kind,
          role: entry.meta.role ?? null,
          name: entry.meta.name,
          description: entry.meta.description ?? null,
          version: templateVersion(entry.meta),
          // The code default as editable instances — the editor seeds a new
          // draft from this, and "preview new default" renders it read-only.
          codeBlocks: instancesFromTemplate(entry.meta.blocks),
          draftBlocks: row?.draftBlocks ?? null,
          publishedBlocks: row?.publishedBlocks ?? null,
          baseVersion: row?.baseVersion ?? null,
          updatedAt: row?.updatedAt?.toISOString() ?? null,
          publishedAt: row?.publishedAt?.toISOString() ?? null,
          ...overrideFlags(entry, row ?? null),
        },
      };
    },
  );

  // ─── Save draft ──────────────────────────────────────────────────────────

  fastify.put<{ Params: { key: string } }>(
    '/overrides/:key',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key' });
      }
      const body = SaveDraftBody.safeParse(request.body);
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

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      const [row] = await db
        .insert(schema.themeOverrides)
        .values({
          tenantId,
          kind: entry.kind,
          templateKey: entry.meta.key,
          draftBlocks: body.data.blocks,
          baseVersion: templateVersion(entry.meta),
          updatedBy: session.user.id,
        })
        .onConflictDoUpdate({
          target: [
            schema.themeOverrides.tenantId,
            schema.themeOverrides.templateKey,
          ],
          set: {
            draftBlocks: body.data.blocks,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          },
        })
        .returning();

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'theme_override.draft_saved',
        resourceType: 'theme_override',
        resourceId: row!.id,
        afterSnapshot: { templateKey: entry.meta.key },
        request,
      });

      return { data: { ...overrideFlags(entry, row!), key: entry.meta.key } };
    },
  );

  // ─── Publish ─────────────────────────────────────────────────────────────

  fastify.post<{ Params: { key: string } }>(
    '/overrides/:key/publish',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key' });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      const [current] = await db
        .select()
        .from(schema.themeOverrides)
        .where(
          and(
            eq(schema.themeOverrides.tenantId, tenantId),
            eq(schema.themeOverrides.templateKey, entry.meta.key),
          ),
        )
        .limit(1);
      if (!current || current.draftBlocks === null) {
        return reply.code(409).send({ error: 'no_draft' });
      }

      const [row] = await db
        .update(schema.themeOverrides)
        .set({
          publishedBlocks: current.draftBlocks,
          draftBlocks: null,
          // Publishing re-bases the override on the CURRENT code structure —
          // the "update available" badge clears until the code moves again.
          baseVersion: templateVersion(entry.meta),
          publishedBy: session.user.id,
          publishedAt: new Date(),
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.themeOverrides.id, current.id))
        .returning();

      await snapshotOverrideRevision(
        current.id,
        tenantId,
        session.user.id,
        'published',
      );

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'theme_override.published',
        resourceType: 'theme_override',
        resourceId: current.id,
        afterSnapshot: { templateKey: entry.meta.key },
        request,
      });

      // Both cache layers drop: the Redis payloads above, and the nitro
      // SWR'd HTML (which embeds them) via the web purge endpoint.
      await invalidateThemeCaches(request.log, tenantId, entry);
      await purgeWebCache(request.log, tenantId);

      return { data: { ...overrideFlags(entry, row!), key: entry.meta.key } };
    },
  );

  // ─── Discard draft ───────────────────────────────────────────────────────

  fastify.post<{ Params: { key: string } }>(
    '/overrides/:key/discard-draft',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key' });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      const [current] = await db
        .select()
        .from(schema.themeOverrides)
        .where(
          and(
            eq(schema.themeOverrides.tenantId, tenantId),
            eq(schema.themeOverrides.templateKey, entry.meta.key),
          ),
        )
        .limit(1);
      if (!current || current.draftBlocks === null) {
        return reply.code(409).send({ error: 'no_draft' });
      }

      let row: typeof current | null = null;
      if (current.publishedBlocks === null) {
        // Draft-only row: discarding the draft leaves nothing — delete it so
        // the entry reads as a pure code default again. Revisions cascade.
        await db
          .delete(schema.themeOverrides)
          .where(eq(schema.themeOverrides.id, current.id));
      } else {
        const rows = await db
          .update(schema.themeOverrides)
          .set({
            draftBlocks: null,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.themeOverrides.id, current.id))
          .returning();
        row = rows[0] ?? null;
      }

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'theme_override.draft_discarded',
        resourceType: 'theme_override',
        resourceId: current.id,
        afterSnapshot: { templateKey: entry.meta.key },
        request,
      });

      return { data: { ...overrideFlags(entry, row), key: entry.meta.key } };
    },
  );

  // ─── Reset to code default ───────────────────────────────────────────────

  fastify.post<{ Params: { key: string } }>(
    '/overrides/:key/reset',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key' });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      const deleted = await db
        .delete(schema.themeOverrides)
        .where(
          and(
            eq(schema.themeOverrides.tenantId, tenantId),
            eq(schema.themeOverrides.templateKey, entry.meta.key),
          ),
        )
        .returning({ id: schema.themeOverrides.id });
      if (deleted.length === 0) {
        return reply.code(404).send({ error: 'Not customized' });
      }

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'theme_override.reset',
        resourceType: 'theme_override',
        resourceId: deleted[0]!.id,
        afterSnapshot: { templateKey: entry.meta.key },
        request,
      });

      await invalidateThemeCaches(request.log, tenantId, entry);
      await purgeWebCache(request.log, tenantId);

      return { data: { ...overrideFlags(entry, null), key: entry.meta.key } };
    },
  );

  // ─── Theme-preview token (the editor's iframe URL) ──────────────────────

  fastify.post<{ Params: { key: string } }>(
    '/overrides/:key/preview-token',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key' });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      const siteUrl = await resolveSiteUrl(tenantId);
      if (!siteUrl) {
        return reply.code(422).send({
          error: 'site_url_not_configured',
          message: 'Set Site URL in Site Settings to enable preview links.',
        });
      }

      const path = await representativePreviewPath(tenantId, entry);
      if (!path) {
        return reply.code(422).send({
          error: 'no_preview_target',
          message:
            'No published content renders this template yet — publish an article first.',
        });
      }

      const { token, expiresAt } = generateThemePreviewToken();
      return {
        data: {
          previewUrl: `${siteUrl}${path}?theme_preview=${encodeURIComponent(token)}`,
          expiresAt: expiresAt.toISOString(),
        },
      };
    },
  );

  // ─── "View on site" target for a Templates & Parts row ──────────────────────
  // The LIVE public path (no preview token) a template renders, so an editor can
  // open the actual published page from Theme Settings. Reuses the same
  // representative-target resolver as the preview iframe. Parts have no
  // standalone URL, so they point at the homepage where their chrome appears.
  // `path` is null when no published content stands the template up yet — the
  // caller toasts a "publish first" hint in that case.
  fastify.get<{ Params: { key: string } }>(
    '/overrides/:key/view-url',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key' });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      const path =
        entry.kind === 'part'
          ? '/'
          : await representativePreviewPath(tenantId, entry);
      return { data: { path } };
    },
  );

  // ─── Per-block default overrides (theme engine v2 Phase 5) ───────────────
  //
  // The Block Gallery's "Edit" opens an editor for ONE block's default fields
  // (copy) + options (sources). Saved as a kind='block' theme_overrides row
  // keyed `block:<key>` holding a single instance; applied site-wide UNDER each
  // placed instance's values (see withBlockOverrides in theme-overrides.ts).
  // Same draft → publish → reset lifecycle as template/part overrides. A
  // per-block default can render in ANY composed payload, so publish/reset
  // clear every block-rendering cache for the tenant.

  const blockDefaultTree = (
    key: string,
    fields: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Array<{
    id: string;
    block_key: string;
    fields: Record<string, unknown>;
    options: Record<string, unknown>;
  }> => [{ id: `block-default-${key}`, block_key: key, fields, options }];

  const readBlockValues = (
    tree: unknown,
  ): {
    fields: Record<string, unknown>;
    options: Record<string, unknown>;
  } | null => {
    if (!Array.isArray(tree) || tree.length === 0) return null;
    const inst = tree[0] as { fields?: unknown; options?: unknown };
    return {
      fields:
        inst.fields && typeof inst.fields === 'object'
          ? (inst.fields as Record<string, unknown>)
          : {},
      options:
        inst.options && typeof inst.options === 'object'
          ? (inst.options as Record<string, unknown>)
          : {},
    };
  };

  const invalidateBlockRenderCaches = async (
    log: { warn: (obj: unknown, msg: string) => void },
    tenantId: string,
  ): Promise<void> => {
    try {
      await invalidatePattern(`cache:view:archive:${tenantId}:*`);
      await invalidatePattern(`cache:view:system:${tenantId}:*`);
      await invalidatePattern(`cache:content:${tenantId}:*`);
      await invalidatePattern(`cache:part:${tenantId}:*`);
      await invalidatePattern(`cache:page:${tenantId}:*`);
    } catch (err) {
      log.warn({ err }, 'block-defaults: cache invalidation failed');
    }
  };

  // GET — block field/option schemas + code defaults + draft/published values.
  fastify.get<{ Params: { key: string } }>(
    '/block-defaults/:key',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid key' });
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const block = getBlock(params.data.key);
      if (!block) return reply.code(404).send({ error: 'Not found' });

      let row: typeof schema.themeOverrides.$inferSelect | null = null;
      try {
        const [r] = await db
          .select()
          .from(schema.themeOverrides)
          .where(
            and(
              eq(schema.themeOverrides.tenantId, tenantId),
              eq(
                schema.themeOverrides.templateKey,
                blockOverrideKey(params.data.key),
              ),
            ),
          )
          .limit(1);
        row = r ?? null;
      } catch (err) {
        if (!isUndefinedTableError(err, 'theme_overrides')) throw err;
      }

      return {
        data: {
          key: block.meta.key,
          label: block.meta.label,
          description: block.meta.description ?? null,
          category: block.meta.category,
          fieldsSchema: block.meta.fields,
          optionsSchema: block.meta.options,
          codeFields: defaultsFor(block.meta.fields),
          codeOptions: defaultsFor(block.meta.options),
          draft: readBlockValues(row?.draftBlocks),
          published: readBlockValues(row?.publishedBlocks),
          customized: !!row?.publishedBlocks,
          hasDraft: !!row?.draftBlocks,
        },
      };
    },
  );

  // PUT — save the block's edited fields/options as the draft.
  fastify.put<{ Params: { key: string } }>(
    '/block-defaults/:key',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid key' });
      const body = BlockDefaultsBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid body' });
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const block = getBlock(params.data.key);
      if (!block) return reply.code(404).send({ error: 'Not found' });

      const tree = blockDefaultTree(
        params.data.key,
        body.data.fields,
        body.data.options,
      );
      let row: typeof schema.themeOverrides.$inferSelect | undefined;
      try {
        [row] = await db
          .insert(schema.themeOverrides)
          .values({
            tenantId,
            kind: BLOCK_OVERRIDE_KIND,
            templateKey: blockOverrideKey(params.data.key),
            draftBlocks: tree,
            baseVersion: 1,
            updatedBy: session.user.id,
          })
          .onConflictDoUpdate({
            target: [
              schema.themeOverrides.tenantId,
              schema.themeOverrides.templateKey,
            ],
            set: {
              draftBlocks: tree,
              updatedBy: session.user.id,
              updatedAt: new Date(),
            },
          })
          .returning();
      } catch (err) {
        if (isUndefinedTableError(err, 'theme_overrides')) {
          return reply.code(503).send({
            error: 'migration_pending',
            message: 'Run db:migrate (0023) to enable block overrides.',
          });
        }
        throw err;
      }

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'theme_override.draft_saved',
        resourceType: 'theme_override',
        resourceId: row!.id,
        afterSnapshot: { blockKey: params.data.key },
        request,
      });

      return {
        data: {
          key: params.data.key,
          customized: !!row!.publishedBlocks,
          hasDraft: !!row!.draftBlocks,
        },
      };
    },
  );

  // POST — publish the draft as the live site-wide default.
  fastify.post<{ Params: { key: string } }>(
    '/block-defaults/:key/publish',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid key' });
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });
      if (!getBlock(params.data.key)) {
        return reply.code(404).send({ error: 'Not found' });
      }

      const [current] = await db
        .select()
        .from(schema.themeOverrides)
        .where(
          and(
            eq(schema.themeOverrides.tenantId, tenantId),
            eq(
              schema.themeOverrides.templateKey,
              blockOverrideKey(params.data.key),
            ),
          ),
        )
        .limit(1);
      if (!current || current.draftBlocks === null) {
        return reply.code(409).send({ error: 'no_draft' });
      }

      const [row] = await db
        .update(schema.themeOverrides)
        .set({
          publishedBlocks: current.draftBlocks,
          draftBlocks: null,
          publishedBy: session.user.id,
          publishedAt: new Date(),
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.themeOverrides.id, current.id))
        .returning();

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'theme_override.published',
        resourceType: 'theme_override',
        resourceId: current.id,
        afterSnapshot: { blockKey: params.data.key },
        request,
      });

      await invalidateBlockRenderCaches(request.log, tenantId);
      await purgeWebCache(request.log, tenantId);

      return {
        data: {
          key: params.data.key,
          customized: !!row!.publishedBlocks,
          hasDraft: !!row!.draftBlocks,
        },
      };
    },
  );

  // POST — discard the draft (live published default is untouched).
  fastify.post<{ Params: { key: string } }>(
    '/block-defaults/:key/discard-draft',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid key' });
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });
      if (!getBlock(params.data.key)) {
        return reply.code(404).send({ error: 'Not found' });
      }

      const [current] = await db
        .select()
        .from(schema.themeOverrides)
        .where(
          and(
            eq(schema.themeOverrides.tenantId, tenantId),
            eq(
              schema.themeOverrides.templateKey,
              blockOverrideKey(params.data.key),
            ),
          ),
        )
        .limit(1);
      if (!current) {
        return {
          data: { key: params.data.key, customized: false, hasDraft: false },
        };
      }

      // Draft-only override → drop the row entirely; otherwise just clear draft.
      if (current.publishedBlocks === null) {
        await db
          .delete(schema.themeOverrides)
          .where(eq(schema.themeOverrides.id, current.id));
      } else {
        await db
          .update(schema.themeOverrides)
          .set({
            draftBlocks: null,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.themeOverrides.id, current.id));
      }
      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'theme_override.draft_discarded',
        resourceType: 'theme_override',
        resourceId: current.id,
        afterSnapshot: { blockKey: params.data.key },
        request,
      });
      return {
        data: {
          key: params.data.key,
          customized: current.publishedBlocks !== null,
          hasDraft: false,
        },
      };
    },
  );

  // POST — reset: delete the override, reverting the block to its code default.
  fastify.post<{ Params: { key: string } }>(
    '/block-defaults/:key/reset',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid key' });
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });
      if (!getBlock(params.data.key)) {
        return reply.code(404).send({ error: 'Not found' });
      }

      const deleted = await db
        .delete(schema.themeOverrides)
        .where(
          and(
            eq(schema.themeOverrides.tenantId, tenantId),
            eq(
              schema.themeOverrides.templateKey,
              blockOverrideKey(params.data.key),
            ),
          ),
        )
        .returning({ id: schema.themeOverrides.id });

      if (deleted.length > 0) {
        await logAudit({
          tenantId,
          actorId: session.user.id,
          action: 'theme_override.reset',
          resourceType: 'theme_override',
          resourceId: deleted[0]!.id,
          afterSnapshot: { blockKey: params.data.key },
          request,
        });
        await invalidateBlockRenderCaches(request.log, tenantId);
        await purgeWebCache(request.log, tenantId);
      }
      return { data: { key: params.data.key, customized: false, hasDraft: false } };
    },
  );

  // POST — a preview-token URL for the block, scoped to the DRAFT override so
  // the editor's iframe shows the unsaved edits.
  fastify.post<{ Params: { key: string } }>(
    '/block-defaults/:key/preview-token',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid key' });
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });
      if (!getBlock(params.data.key)) {
        return reply.code(404).send({ error: 'Not found' });
      }

      const siteUrl = await resolveSiteUrl(tenantId);
      if (!siteUrl) {
        return reply.code(422).send({
          error: 'site_url_not_configured',
          message: 'Set Site URL in Site Settings to enable preview links.',
        });
      }

      const { token, expiresAt } = generateThemePreviewToken();
      return {
        data: {
          previewUrl: `${siteUrl}/preview/block/${encodeURIComponent(params.data.key)}?embed=1&theme_preview=${encodeURIComponent(token)}`,
          expiresAt: expiresAt.toISOString(),
        },
      };
    },
  );

  // ─── Revisions ───────────────────────────────────────────────────────────

  fastify.get<{ Params: { key: string } }>(
    '/overrides/:key/revisions',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = KeyParam.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key' });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      const [row] = await db
        .select({ id: schema.themeOverrides.id })
        .from(schema.themeOverrides)
        .where(
          and(
            eq(schema.themeOverrides.tenantId, tenantId),
            eq(schema.themeOverrides.templateKey, entry.meta.key),
          ),
        )
        .limit(1);
      if (!row) return { data: [] };

      const revisions = await db
        .select({
          id: schema.themeOverrideRevisions.id,
          revisionNumber: schema.themeOverrideRevisions.revisionNumber,
          changeSummary: schema.themeOverrideRevisions.changeSummary,
          changedBy: schema.themeOverrideRevisions.changedBy,
          createdAt: schema.themeOverrideRevisions.createdAt,
        })
        .from(schema.themeOverrideRevisions)
        .where(eq(schema.themeOverrideRevisions.overrideId, row.id))
        .orderBy(desc(schema.themeOverrideRevisions.revisionNumber))
        .limit(20);

      return { data: revisions };
    },
  );

  // ─── Restore a revision (into the DRAFT — never directly live) ──────────

  fastify.post<{ Params: { key: string; n: string } }>(
    '/overrides/:key/revisions/:n/restore',
    { preHandler: requireAdminRole('admin') },
    async (request, reply) => {
      const params = RevisionParams.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid params' });
      }
      const session = request.adminSession!;
      const tenantId = session.user.tenantId;
      if (!tenantId) return reply.code(403).send({ error: 'Tenant required' });

      const entry = findThemeEntry(params.data.key);
      if (!entry) return reply.code(404).send({ error: 'Not found' });

      const [row] = await db
        .select()
        .from(schema.themeOverrides)
        .where(
          and(
            eq(schema.themeOverrides.tenantId, tenantId),
            eq(schema.themeOverrides.templateKey, entry.meta.key),
          ),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'Not customized' });

      const [revision] = await db
        .select()
        .from(schema.themeOverrideRevisions)
        .where(
          and(
            eq(schema.themeOverrideRevisions.overrideId, row.id),
            eq(schema.themeOverrideRevisions.revisionNumber, params.data.n),
          ),
        )
        .limit(1);
      if (!revision) return reply.code(404).send({ error: 'Revision not found' });

      const snapshot = revision.snapshot as { blocks?: unknown } | null;
      const parsed = z
        .array(PageBlockInstanceSchema)
        .safeParse(snapshot?.blocks ?? null);
      if (!parsed.success) {
        return reply.code(422).send({ error: 'snapshot_invalid' });
      }

      const updated = await db
        .update(schema.themeOverrides)
        .set({
          draftBlocks: parsed.data,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.themeOverrides.id, row.id))
        .returning();

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'theme_override.revision_restored',
        resourceType: 'theme_override',
        resourceId: row.id,
        afterSnapshot: {
          templateKey: entry.meta.key,
          revisionNumber: params.data.n,
        },
        request,
      });

      return {
        data: { ...overrideFlags(entry, updated[0]!), key: entry.meta.key },
      };
    },
  );
};
