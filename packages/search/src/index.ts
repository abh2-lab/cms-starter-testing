export { closeMeili, meili } from './client.js';
export {
  CONTENT_INDEX_NAME,
  buildContentDocument,
  documentChecksum,
  ensureContentIndexConfig,
  extractProseMirrorText,
  loadLatestIndexLogByContent,
  removeContentFromIndex,
  removeContentFromIndexStrict,
  shouldReindex,
  upsertContentById,
  upsertContentByIdStrict,
} from './indexing.js';
export type {
  ContentDocument,
  IndexedTaxonomyTerm,
  IndexLogEntry,
} from './indexing.js';
export { reindexAllContent } from './reindex.js';
export type { ReindexOptions, ReindexResult } from './reindex.js';
