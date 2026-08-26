import { and, asc, eq, gt, inArray, type SQL } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { meili } from './client.js';
import {
  CONTENT_INDEX_NAME,
  buildContentDocument,
  documentChecksum,
  loadLatestIndexLogByContent,
  shouldReindex,
  type ContentDocument,
} from './indexing.js';

const BATCH_SIZE = 100;

export interface ReindexOptions {
  /** Limit to a single tenant; default scans all. */
  tenantId?: string;
  /** When true, re-send every document even if the checksum matches. */
  force?: boolean;
}

export interface ReindexResult {
  scanned: number;
  indexed: number;
  skipped: number;
  errors: number;
}

/**
 * Walk every content row in keyset-paginated batches, build documents, and
 * push only those whose checksum differs from the latest search_index_log
 * entry — that keeps the nightly run cheap when nothing changed (the common
 * case). Pass `force: true` to bypass the skip check during recovery.
 *
 * Append-only: each indexed row writes a new search_index_log entry; the
 * loader picks the newest by indexedAt.
 *
 * Called from:
 *   - the worker's maintenance.meili-drift-sweep job (Phase 6+, nightly)
 *   - the API CLI script `pnpm --filter @cms/api meili:reindex` (manual)
 */
export async function reindexAllContent(
  opts: ReindexOptions = {},
): Promise<ReindexResult> {
  const result: ReindexResult = {
    scanned: 0,
    indexed: 0,
    skipped: 0,
    errors: 0,
  };

  let cursor: string | null = null;
  // Keyset paginate by id (uuidv7 is time-ordered, so this is also roughly
  // creation-ordered and safe across concurrent writes).
  while (true) {
    const conditions: SQL[] = [];
    if (opts.tenantId !== undefined) {
      conditions.push(eq(schema.content.tenantId, opts.tenantId));
    }
    if (cursor !== null) {
      conditions.push(gt(schema.content.id, cursor));
    }

    const rows = await db
      .select({
        id: schema.content.id,
        tenantId: schema.content.tenantId,
        title: schema.content.title,
        slug: schema.content.slug,
        status: schema.content.status,
        contentTypeId: schema.content.contentTypeId,
        contentTypeSlug: schema.contentTypes.slug,
        customFields: schema.content.customFields,
        featured: schema.content.featured,
        locale: schema.content.locale,
        publishedAt: schema.content.publishedAt,
        publishAt: schema.content.publishAt,
        unpublishAt: schema.content.unpublishAt,
        createdAt: schema.content.createdAt,
        viewCount: schema.content.viewCount,
        authorDisplayName: schema.adminUsers.displayName,
      })
      .from(schema.content)
      .innerJoin(
        schema.contentTypes,
        eq(schema.content.contentTypeId, schema.contentTypes.id),
      )
      .leftJoin(
        schema.adminUsers,
        eq(schema.content.authorId, schema.adminUsers.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.content.id))
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    result.scanned += rows.length;

    // Batch-fetch taxonomy in one query for the whole page.
    const ids = rows.map((r) => r.id);
    const taxRows = await db
      .select({
        contentId: schema.contentTaxonomyTerms.contentId,
        termSlug: schema.taxonomyTerms.slug,
        termName: schema.taxonomyTerms.name,
        taxonomySlug: schema.taxonomies.slug,
        taxonomyKind: schema.taxonomies.kind,
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
      .where(inArray(schema.contentTaxonomyTerms.contentId, ids));
    const taxByContent = new Map<
      string,
      {
        termSlug: string;
        termName: string;
        taxonomySlug: string;
        taxonomyKind: string;
      }[]
    >();
    for (const t of taxRows) {
      const list = taxByContent.get(t.contentId) ?? [];
      list.push({
        termSlug: t.termSlug,
        termName: t.termName,
        taxonomySlug: t.taxonomySlug,
        taxonomyKind: t.taxonomyKind,
      });
      taxByContent.set(t.contentId, list);
    }

    const latestLog = await loadLatestIndexLogByContent(ids);

    const docsToSend: ContentDocument[] = [];
    const logsToWrite: {
      contentId: string;
      tenantId: string | null;
      checksum: string;
    }[] = [];

    for (const row of rows) {
      const doc = buildContentDocument(
        {
          ...row,
          customFields:
            (row.customFields as Record<string, unknown> | null) ?? null,
        },
        taxByContent.get(row.id) ?? [],
      );
      const checksum = documentChecksum(doc);
      if (shouldReindex(checksum, latestLog.get(row.id), opts.force ?? false)) {
        docsToSend.push(doc);
        logsToWrite.push({
          contentId: row.id,
          tenantId: row.tenantId,
          checksum,
        });
      } else {
        result.skipped += 1;
      }
    }

    if (docsToSend.length > 0) {
      try {
        await meili.index(CONTENT_INDEX_NAME).addDocuments(docsToSend);
        await db.insert(schema.searchIndexLog).values(
          logsToWrite.map((l) => ({
            contentId: l.contentId,
            tenantId: l.tenantId,
            indexName: CONTENT_INDEX_NAME,
            checksum: l.checksum,
          })),
        );
        result.indexed += docsToSend.length;
      } catch (err) {
        result.errors += docsToSend.length;
        console.warn(
          `[meili] batch send failed (${docsToSend.length} docs):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  return result;
}
