// Thin re-export — bulk reindex lives in @cms/search alongside the
// single-row indexing helpers, so the worker (maintenance.meili-drift-sweep)
// and the API CLI script call identical code.
export { reindexAllContent } from '@cms/search';
export type { ReindexOptions, ReindexResult } from '@cms/search';
