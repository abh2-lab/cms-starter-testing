/**
 * Full bulk Meili reindex.
 *
 * Usage:
 *   pnpm --filter @cms/api meili:reindex             # incremental, checksum-skipped
 *   pnpm --filter @cms/api meili:reindex -- --force  # re-send every document
 *
 * Use after first install (to seed the index), after rotating Meili master key,
 * or to recover from drift. The API's in-process cron runs this nightly too;
 * this script is for ops that prefer external cron or one-off recovery.
 */
import {
  ensureContentIndexConfig,
} from '../src/lib/meili-indexing.js';
import { reindexAllContent } from '../src/lib/meili-reindex.js';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  await ensureContentIndexConfig();
  const start = Date.now();
  const r = await reindexAllContent({ force });
  console.log(
    `meili reindex (force=${force}): scanned=${r.scanned} indexed=${r.indexed} skipped=${r.skipped} errors=${r.errors} in ${Date.now() - start}ms.`,
  );
  process.exit(r.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('meili:reindex failed', err);
  process.exit(1);
});
