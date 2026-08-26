// Thin re-export — the Meili client lives in @cms/search/dist/client.js so
// both the API and the worker share one source of truth. Kept here as a
// stable import path for the existing API code (routes, tests, scripts).
export { closeMeili, meili } from '@cms/search';
