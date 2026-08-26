import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  like,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@cms/db';
import { tenantFilter } from '../../lib/tenant-scope.js';
import { requireAdminAuth } from '../../middleware/require-auth.js';
import { requireAdminRole } from '../../middleware/require-role.js';
import { logAudit } from '../../lib/audit.js';
import {
  ALLOWED_MIME_TYPES,
  checkMediaUpload,
} from '../../lib/media-allowlist.js';
import { producers } from '../../lib/queue.js';
import { dispatchEvent } from '../../lib/webhook-dispatch.js';
import {
  buildStorageKey,
  deleteObject,
  objectUrl,
  presignPut,
} from '../../lib/s3.js';

// ─── Validation schemas ────────────────────────────────────────────────────

const PresignBody = z.object({
  filename: z.string().min(1).max(500),
  // contentType is validated against MEDIA_ALLOWLIST in the handler so we
  // can return a richer 415 with the full allowed list, instead of a Zod
  // enum error that just says "invalid". The min/max here keeps obvious
  // garbage out of the allowlist lookup.
  contentType: z.string().min(1).max(255),
});

const RegisterBody = z.object({
  storageKey: z.string().min(1).max(1024),
  originalFilename: z.string().min(1).max(500),
  // Same rationale as PresignBody.contentType — handler enforces the
  // allowlist + per-type size cap.
  mimeType: z.string().min(1).max(255),
  fileSizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  altText: z.string().max(1000).nullable().optional(),
  caption: z.string().max(2000).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
});

const UpdateBody = z.object({
  altText: z.string().max(1000).nullable().optional(),
  caption: z.string().max(2000).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
});

const ListQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  folderId: z.string().uuid().optional(),
  // mime-type prefix filter, e.g. "image" matches image/*
  type: z.string().min(1).max(50).optional(),
  // free-text search over filename + alt text (case-insensitive substring)
  q: z.string().min(1).max(255).optional(),
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

// media.tenant_id is NOT NULL on insert (write paths need a real tenant id),
// so a request with `session.user.tenantId === null` can't create new media.
// For reads, the shared `tenantFilter` from ../../lib/tenant-scope handles
// super_admin scoping — null is fine there.
function tenantOf(request: FastifyRequest, reply: FastifyReply): string | null {
  const session = getSession(request);
  if (session.user.tenantId === null) {
    reply.code(400).send({ error: 'Media requires a tenant context' });
    return null;
  }
  return session.user.tenantId;
}

function isStorageKeyConflict(e: unknown): boolean {
  return e instanceof Error && e.message.includes('media_storage_key_uniq');
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

async function withUrl<T extends { storageKey: string }>(
  row: T,
): Promise<T & { url: string }> {
  return { ...row, url: await objectUrl(row.storageKey) };
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const adminMediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdminAuth);

  // POST /presign — get a presigned PUT URL; the browser uploads bytes directly
  // to S3, then calls POST / to register the completed upload.
  fastify.post(
    '/presign',
    { preHandler: requireAdminRole('author') },
    async (request, reply) => {
      const parsed = PresignBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;

      // Reject up-front so a disallowed file never even gets a presigned URL.
      // Register re-checks because a client could lie about contentType here
      // and submit a different mimeType to register.
      const fail = checkMediaUpload(parsed.data.contentType);
      if (fail) {
        return reply.code(415).send({
          error: fail.message,
          allowed: ALLOWED_MIME_TYPES,
        });
      }

      const storageKey = buildStorageKey(tenantId, parsed.data.filename);
      const url = await presignPut(storageKey, parsed.data.contentType);
      return {
        data: {
          url,
          storageKey,
          method: 'PUT',
          headers: { 'Content-Type': parsed.data.contentType },
        },
      };
    },
  );

  // POST / — register a completed upload as a media row.
  fastify.post(
    '/',
    { preHandler: requireAdminRole('author') },
    async (request, reply) => {
      const parsed = RegisterBody.safeParse(request.body);
      if (!parsed.success) return sendZodError(reply, parsed.error);
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;

      // Defence in depth — even with the presign gate, a client could PUT
      // bytes to a presigned URL and then call /register claiming a different
      // mimeType to slip past the allowlist. Enforce again with size.
      const fail = checkMediaUpload(parsed.data.mimeType, parsed.data.fileSizeBytes);
      if (fail) {
        return reply
          .code(fail.reason === 'over_size_cap' ? 413 : 415)
          .send({ error: fail.message, allowed: ALLOWED_MIME_TYPES });
      }
      const session = getSession(request);

      try {
        const isImage = parsed.data.mimeType.startsWith('image/');
        const [row] = await db
          .insert(schema.media)
          .values({
            ...parsed.data,
            tenantId,
            uploadedBy: session.user.id,
            // Images start as 'pending' so the worker picks them up for
            // variant generation. Non-images (PDFs, etc.) skip processing
            // entirely — usable immediately.
            processingStatus: isImage ? 'pending' : 'ready',
          })
          .returning();
        if (!row) return reply.code(500).send({ error: 'Insert failed' });
        await logAudit({
          tenantId,
          actorId: session.user.id,
          action: 'media.uploaded',
          resourceType: 'media',
          resourceId: row.id,
          afterSnapshot: {
            filename: row.originalFilename,
            mimeType: row.mimeType,
            fileSizeBytes: row.fileSizeBytes,
          },
          request,
        });
        void dispatchEvent(
          request.log,
          'media.uploaded',
          {
            id: row.id,
            originalFilename: row.originalFilename,
            mimeType: row.mimeType,
            fileSizeBytes: row.fileSizeBytes,
          },
          row.tenantId,
          request.id,
        );
        if (isImage) {
          void producers.images
            .generateVariants({
              mediaId: row.id,
              tenantId: row.tenantId,
              storageKey: row.storageKey,
              reqId: request.id,
            })
            .catch((err: unknown) => {
              request.log.warn(
                { err, mediaId: row.id },
                'enqueue image-process failed',
              );
            });
        }
        return reply.code(201).send({ data: await withUrl(row) });
      } catch (e: unknown) {
        if (isStorageKeyConflict(e)) {
          return reply
            .code(409)
            .send({ error: 'This object is already registered' });
        }
        throw e;
      }
    },
  );

  // GET / — list media (tenant-scoped) with cursor pagination + filters.
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
    const tenantId = tenantOf(request, reply);
    if (tenantId === null) return reply;
    const session = getSession(request);

    const conditions: (SQL | undefined)[] = [
      tenantFilter(session.user, schema.media.tenantId),
    ];
    if (query.data.folderId) {
      conditions.push(eq(schema.media.folderId, query.data.folderId));
    }
    if (query.data.type) {
      conditions.push(like(schema.media.mimeType, `${query.data.type}/%`));
    }
    if (query.data.q) {
      // Case-insensitive substring over filename + alt text. Cursor pagination
      // still applies, so searches page with "Load more" like any other list.
      const term = `%${query.data.q}%`;
      conditions.push(
        or(
          ilike(schema.media.originalFilename, term),
          ilike(schema.media.altText, term),
        ),
      );
    }
    if (query.data.cursor) {
      conditions.push(lt(schema.media.id, query.data.cursor));
    }

    const rows = await db
      .select()
      .from(schema.media)
      .where(and(...conditions))
      .orderBy(desc(schema.media.id))
      .limit(query.data.limit + 1);

    const hasMore = rows.length > query.data.limit;
    const data = hasMore ? rows.slice(0, query.data.limit) : rows;
    const withUrls = await Promise.all(data.map((r) => withUrl(r)));

    // Attach a fast thumbnail URL (the 200px WebP variant) when it exists, so a
    // grid loads small images instead of full-size originals. Falls back to the
    // original url for non-images or media still awaiting variant generation.
    const ids = withUrls.map((r) => r.id);
    const thumbRows = ids.length
      ? await db
          .select({
            mediaId: schema.mediaVariants.mediaId,
            storageKey: schema.mediaVariants.storageKey,
          })
          .from(schema.mediaVariants)
          .where(
            and(
              inArray(schema.mediaVariants.mediaId, ids),
              eq(schema.mediaVariants.variantKey, 'thumb_webp_200'),
            ),
          )
      : [];
    const thumbKeyById = new Map(
      thumbRows.map((t) => [t.mediaId, t.storageKey]),
    );
    const withThumbs = await Promise.all(
      withUrls.map(async (r) => {
        const key = thumbKeyById.get(r.id);
        return { ...r, thumbUrl: key ? await objectUrl(key) : r.url };
      }),
    );
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return {
      data: withThumbs,
      pagination: { nextCursor, hasMore, limit: query.data.limit },
    };
  });

  // GET /:id — detail, including generated variants (with display URLs).
  fastify.get('/:id', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
    const tenantId = tenantOf(request, reply);
    if (tenantId === null) return reply;
    const session = getSession(request);

    const [row] = await db
      .select()
      .from(schema.media)
      .where(
        and(
          eq(schema.media.id, params.data.id),
          tenantFilter(session.user, schema.media.tenantId),
        ),
      )
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'Not found' });

    const variants = await db
      .select()
      .from(schema.mediaVariants)
      .where(eq(schema.mediaVariants.mediaId, row.id));
    const variantsWithUrls = await Promise.all(
      variants.map((v) => withUrl(v)),
    );

    return { data: { ...(await withUrl(row)), variants: variantsWithUrls } };
  });

  // GET /:id/usage — find content rows and pages referencing this media item.
  //
  // Reverse lookup is best-effort: we cast the structured JSONB to text and
  // match the media UUID as a substring. This catches media_single and
  // media_gallery fields (which store the bare media id) AND the `blocks`
  // jsonb on dynamic pages. It does NOT catch inline body images in rich-
  // text content — those are free-text URLs and the lossy detection would
  // produce false positives. The widget surfaces this caveat to the user.
  //
  // No GIN index today: the table is small in a single-tenant install and
  // the drawer is loaded on demand (not a hot path). Add an index later if
  // editors complain about the drawer being slow with thousands of rows.
  fastify.get('/:id/usage', async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
    const tenantId = tenantOf(request, reply);
    if (tenantId === null) return reply;
    const session = getSession(request);

    const mediaId = params.data.id;

    const [contentRefs, pageRefs] = await Promise.all([
      db
        .select({
          id: schema.content.id,
          title: schema.content.title,
          status: schema.content.status,
          contentTypeId: schema.content.contentTypeId,
          typeSlug: schema.contentTypes.slug,
          typeName: schema.contentTypes.name,
        })
        .from(schema.content)
        .leftJoin(
          schema.contentTypes,
          eq(schema.content.contentTypeId, schema.contentTypes.id),
        )
        .where(
          and(
            tenantFilter(session.user, schema.content.tenantId),
            sql`${schema.content.customFields}::text LIKE ${'%' + mediaId + '%'}`,
          ),
        )
        .limit(100),
      db
        .select({
          id: schema.pages.id,
          title: schema.pages.title,
          slug: schema.pages.slug,
          status: schema.pages.status,
        })
        .from(schema.pages)
        .where(
          and(
            tenantFilter(session.user, schema.pages.tenantId),
            sql`${schema.pages.blocks}::text LIKE ${'%' + mediaId + '%'}`,
          ),
        )
        .limit(100),
    ]);

    return { data: { contentRefs, pageRefs } };
  });

  // POST /:id/reprocess — flip a failed (or stuck-pending) media row back to
  // 'pending' and re-enqueue an image-process job. Useful when the original
  // upload was corrupt and re-uploaded, or when ops want to regenerate
  // variants after a Sharp config change.
  fastify.post(
    '/:id/reprocess',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);

      const [row] = await db
        .update(schema.media)
        .set({ processingStatus: 'pending', updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.media.id, params.data.id),
            tenantFilter(session.user, schema.media.tenantId),
          ),
        )
        .returning();
      if (!row) return reply.code(404).send({ error: 'Not found' });
      if (!row.mimeType.startsWith('image/')) {
        return reply.code(400).send({
          error: 'Reprocess is only meaningful for images',
        });
      }
      void producers.images
        .generateVariants({
          mediaId: row.id,
          tenantId: row.tenantId,
          storageKey: row.storageKey,
          reqId: request.id,
        })
        .catch((err: unknown) => {
          request.log.warn(
            { err, mediaId: row.id },
            'enqueue image-process (reprocess) failed',
          );
        });
      return reply.code(202).send({ data: { id: row.id, processingStatus: row.processingStatus } });
    },
  );

  // PATCH /:id — edit alt text / caption / folder (author+).
  fastify.patch(
    '/:id',
    { preHandler: requireAdminRole('author') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const body = UpdateBody.safeParse(request.body);
      if (!body.success) return sendZodError(reply, body.error);
      if (Object.keys(body.data).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);

      const [row] = await db
        .update(schema.media)
        .set({ ...body.data, updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.media.id, params.data.id),
            tenantFilter(session.user, schema.media.tenantId),
          ),
        )
        .returning();
      if (!row) return reply.code(404).send({ error: 'Not found' });
      return { data: await withUrl(row) };
    },
  );

  // DELETE /:id — remove the row (variants cascade) + best-effort object delete.
  fastify.delete(
    '/:id',
    { preHandler: requireAdminRole('editor') },
    async (request, reply) => {
      const params = IdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid id' });
      const tenantId = tenantOf(request, reply);
      if (tenantId === null) return reply;
      const session = getSession(request);

      const [row] = await db
        .select({
          id: schema.media.id,
          storageKey: schema.media.storageKey,
          originalFilename: schema.media.originalFilename,
          mimeType: schema.media.mimeType,
        })
        .from(schema.media)
        .where(
          and(
            eq(schema.media.id, params.data.id),
            tenantFilter(session.user, schema.media.tenantId),
          ),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'Not found' });

      const variants = await db
        .select({ storageKey: schema.mediaVariants.storageKey })
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.mediaId, row.id));

      await db.delete(schema.media).where(eq(schema.media.id, row.id));

      await logAudit({
        tenantId,
        actorId: session.user.id,
        action: 'media.deleted',
        resourceType: 'media',
        resourceId: row.id,
        beforeSnapshot: {
          filename: row.originalFilename,
          mimeType: row.mimeType,
        },
        request,
      });

      try {
        await Promise.all([
          deleteObject(row.storageKey),
          ...variants.map((v) => deleteObject(v.storageKey)),
        ]);
      } catch {
        // Object cleanup is best-effort; the DB row is already gone.
      }

      return reply.code(204).send();
    },
  );
};
