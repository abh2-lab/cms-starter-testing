// Thin re-export — content indexing helpers live in @cms/search so both the
// API (synchronous Phase 5 callers) and the worker (asynchronous Phase 6
// queue processor) share one implementation. Kept here as a stable import
// path for the existing API code (routes, tests, scripts).
export {
  CONTENT_INDEX_NAME,
  buildContentDocument,
  documentChecksum,
  ensureContentIndexConfig,
  extractProseMirrorText,
  loadLatestIndexLogByContent,
  removeContentFromIndex,
  shouldReindex,
  upsertContentById,
} from '@cms/search';
export type {
  ContentDocument,
  IndexedTaxonomyTerm,
  IndexLogEntry,
} from '@cms/search';
