import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { meili } from './client.js';

export const CONTENT_INDEX_NAME = 'content';

// ─── ProseMirror → plain text ──────────────────────────────────────────────

interface ProseNode {
  type?: string;
  text?: string;
  content?: ProseNode[];
}

/**
 * Walk a Tiptap/ProseMirror JSON doc and concatenate every text node into a
 * single string for full-text indexing. Returns '' for null/undefined/garbage
 * input so callers don't need their own guards.
 */
export function extractProseMirrorText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const out: string[] = [];
  const walk = (node: ProseNode | undefined): void => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string' && node.text.length > 0) {
      out.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };
  walk(doc);
  // Single spaces between text nodes — block boundaries are lost, but that's
  // fine for keyword search. Trim to keep checksums stable.
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Document shape ────────────────────────────────────────────────────────

export interface IndexedTaxonomyTerm {
  termSlug: string;
  termName: string;
  taxonomySlug: string;
}

export interface ContentDocument {
  id: string;
  tenantId: string | null;
  title: string;
  slug: string;
  status: string;
  contentTypeId: string;
  contentTypeSlug: string;
  subtitle: string;
  summary: string;
  body_text: string;
  badge: string;
  heroImageKey: string | null;
  authorDisplayName: string | null;
  /** Slug arrays exist for cheap Meili filters; the rich form is for rendering. */
  taxonomyTermSlugs: string[];
  categoryTermSlugs: string[];
  tagTermSlugs: string[];
  taxonomy: IndexedTaxonomyTerm[];
  featured: boolean;
  locale: string;
  publishedAtUnix: number | null;
  publishAtUnix: number | null;
  unpublishAtUnix: number | null;
  createdAtUnix: number;
  viewCount: number;
}

interface ContentRowForIndexing {
  id: string;
  tenantId: string | null;
  title: string;
  slug: string;
  status: string;
  contentTypeId: string;
  contentTypeSlug: string;
  customFields: Record<string, unknown> | null;
  authorDisplayName: string | null;
  featured: boolean;
  locale: string;
  publishedAt: Date | null;
  publishAt: Date | null;
  unpublishAt: Date | null;
  createdAt: Date;
  viewCount: number;
}

interface TaxonomyForIndexing {
  termSlug: string;
  termName: string;
  taxonomySlug: string;
  // Known values 'category' | 'tag'; typed as plain string for forward-compat
  // (typescript-eslint/no-redundant-type-constituents flags the union as
  // redundant — string subsumes the literals).
  taxonomyKind: string;
}

function readString(obj: Record<string, unknown> | null, key: string): string {
  if (!obj) return '';
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

function unixOrNull(d: Date | null | undefined): number | null {
  if (!d) return null;
  const t = d.getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export function buildContentDocument(
  row: ContentRowForIndexing,
  taxonomy: TaxonomyForIndexing[],
): ContentDocument {
  const cf = row.customFields ?? {};
  const taxonomyTermSlugs = taxonomy.map((t) => t.termSlug);
  const categoryTermSlugs = taxonomy
    .filter((t) => t.taxonomyKind === 'category')
    .map((t) => t.termSlug);
  const tagTermSlugs = taxonomy
    .filter((t) => t.taxonomyKind === 'tag')
    .map((t) => t.termSlug);
  const taxonomyRich: IndexedTaxonomyTerm[] = taxonomy.map((t) => ({
    termSlug: t.termSlug,
    termName: t.termName,
    taxonomySlug: t.taxonomySlug,
  }));

  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    slug: row.slug,
    status: row.status,
    contentTypeId: row.contentTypeId,
    contentTypeSlug: row.contentTypeSlug,
    subtitle: readString(cf, 'subtitle'),
    summary: readString(cf, 'summary'),
    body_text: extractProseMirrorText(cf['body']),
    badge: readString(cf, 'badge'),
    heroImageKey:
      typeof cf['hero_image_key'] === 'string' ? cf['hero_image_key'] : null,
    authorDisplayName: row.authorDisplayName,
    taxonomyTermSlugs,
    categoryTermSlugs,
    tagTermSlugs,
    taxonomy: taxonomyRich,
    featured: row.featured,
    locale: row.locale,
    publishedAtUnix: unixOrNull(row.publishedAt),
    publishAtUnix: unixOrNull(row.publishAt),
    unpublishAtUnix: unixOrNull(row.unpublishAt),
    createdAtUnix: Math.floor(row.createdAt.getTime() / 1000),
    viewCount: row.viewCount,
  };
}

/**
 * Canonical-JSON SHA-256 used by the nightly drift reindexer to decide
 * whether to re-send a document. Sorted keys = deterministic output even
 * if downstream object construction order changes.
 */
export function documentChecksum(doc: ContentDocument): string {
  const canonical = JSON.stringify(doc, Object.keys(doc).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

// ─── Index configuration ───────────────────────────────────────────────────

/**
 * Create the content index (if missing) and pin its searchable / filterable /
 * sortable attributes. Idempotent: running it twice in a row is a no-op once
 * settings match. Called once at server boot from apps/api/src/index.ts.
 *
 * Fail-open: a Meili outage at boot must NOT crash the API — search is
 * non-essential to serving content. Errors are logged and swallowed.
 */
export async function ensureContentIndexConfig(): Promise<void> {
  try {
    // createIndex is also idempotent when the index already exists, but the
    // SDK throws on conflict. getIndex → createIndex avoids the spurious throw.
    try {
      await meili.getIndex(CONTENT_INDEX_NAME);
    } catch {
      await meili.createIndex(CONTENT_INDEX_NAME, { primaryKey: 'id' });
    }
    const index = meili.index(CONTENT_INDEX_NAME);
    await index.updateSettings({
      searchableAttributes: [
        'title',
        'subtitle',
        'summary',
        'body_text',
        'badge',
      ],
      filterableAttributes: [
        'tenantId',
        'status',
        'contentTypeId',
        'contentTypeSlug',
        'taxonomyTermSlugs',
        'categoryTermSlugs',
        'tagTermSlugs',
        'featured',
        'locale',
        'publishAtUnix',
        'unpublishAtUnix',
      ],
      sortableAttributes: [
        'publishedAtUnix',
        'createdAtUnix',
        'viewCount',
        'featured',
      ],
    });
  } catch (err) {
    console.warn(
      '[meili] ensureContentIndexConfig failed (search will be degraded):',
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ─── Single-row indexing ───────────────────────────────────────────────────

/**
 * Index a single content row. Throws on any DB/Meili error — used by the
 * worker processor so BullMQ can retry with exponential backoff. The sync
 * fail-open variant (`upsertContentById` below) wraps this and swallows.
 *
 * Records a row in search_index_log on success so the nightly drift job can
 * skip when nothing changed. Drafts are indexed too — visibility is enforced
 * at query time by the public route's filter, while the admin route uses the
 * same index for full-text search across all statuses.
 */
export async function upsertContentByIdStrict(contentId: string): Promise<void> {
  const [row] = await db
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
    .where(eq(schema.content.id, contentId))
    .limit(1);
  if (!row) {
    // Row was deleted between event and index — make sure Meili is in sync.
    await removeContentFromIndexStrict(contentId);
    return;
  }

  const taxonomy = await db
    .select({
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
    .where(eq(schema.contentTaxonomyTerms.contentId, contentId));

  const doc = buildContentDocument(
    {
      ...row,
      customFields:
        (row.customFields as Record<string, unknown> | null) ?? null,
    },
    taxonomy,
  );
  const checksum = documentChecksum(doc);

  await meili.index(CONTENT_INDEX_NAME).addDocuments([doc]);

  // Append a log row — keeps history (one row per index), the drift job
  // reads the latest by indexedAt and compares its checksum.
  await db
    .insert(schema.searchIndexLog)
    .values({
      contentId: row.id,
      tenantId: row.tenantId,
      indexName: CONTENT_INDEX_NAME,
      checksum,
    });
}

export async function removeContentFromIndexStrict(
  contentId: string,
): Promise<void> {
  await meili.index(CONTENT_INDEX_NAME).deleteDocument(contentId);
  // Append a tombstone so the drift detector knows the content was
  // intentionally removed (checksum '' = "not in index").
  await db.insert(schema.searchIndexLog).values({
    contentId,
    tenantId: null,
    indexName: CONTENT_INDEX_NAME,
    checksum: '',
  });
}

/**
 * Fail-open wrapper around upsertContentByIdStrict — used by API callsites
 * that need search to NOT block a content write (publish, etc.). A Meili
 * outage logs a warning; the next nightly drift sweep will catch up.
 *
 * For new code, prefer enqueueing a search-index job (Phase 6+) so failures
 * are retried with backoff and visible in Bull Board.
 */
export async function upsertContentById(contentId: string): Promise<void> {
  try {
    await upsertContentByIdStrict(contentId);
  } catch (err) {
    console.warn(
      `[meili] upsertContentById(${contentId}) failed (search will catch up via nightly reindex):`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function removeContentFromIndex(
  contentId: string,
): Promise<void> {
  try {
    await removeContentFromIndexStrict(contentId);
  } catch (err) {
    console.warn(
      `[meili] removeContentFromIndex(${contentId}) failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ─── Bulk helpers (used by the reindex script + cron) ──────────────────────

export interface IndexLogEntry {
  contentId: string;
  checksum: string;
  indexedAt: Date;
}

/**
 * Latest log entry per content id, scoped to the content index. Returned as
 * a Map for O(1) lookup by the reindexer's "skip if checksum matches" pass.
 */
export async function loadLatestIndexLogByContent(
  contentIds: string[],
): Promise<Map<string, IndexLogEntry>> {
  if (contentIds.length === 0) return new Map();
  const rows = await db
    .select({
      contentId: schema.searchIndexLog.contentId,
      checksum: schema.searchIndexLog.checksum,
      indexedAt: schema.searchIndexLog.indexedAt,
    })
    .from(schema.searchIndexLog)
    .where(
      and(
        eq(schema.searchIndexLog.indexName, CONTENT_INDEX_NAME),
        inArray(schema.searchIndexLog.contentId, contentIds),
      ),
    );
  // Keep the newest row per content id — append-only table, multiple rows.
  const latest = new Map<string, IndexLogEntry>();
  for (const r of rows) {
    const prev = latest.get(r.contentId);
    if (!prev || r.indexedAt.getTime() > prev.indexedAt.getTime()) {
      latest.set(r.contentId, r);
    }
  }
  return latest;
}

/**
 * Decision helper used by reindexAllContent. Pure — exported so the unit
 * tests cover the skip-vs-resend matrix without a DB.
 */
export function shouldReindex(
  newChecksum: string,
  existing: IndexLogEntry | undefined,
  force: boolean,
): boolean {
  if (force) return true;
  if (!existing) return true;
  if (existing.checksum === '') return true; // tombstoned, needs re-index
  return existing.checksum !== newChecksum;
}
