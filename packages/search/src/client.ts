import { Meilisearch } from 'meilisearch';
import { env } from '@cms/config';

// One Meili client per process. Configured so a Meili outage degrades search
// to "no results / fall back to Postgres" rather than blocking writes or
// crashing the process. The SDK is fetch-based and connects lazily, so
// importing this module is cheap even if Meili is down.

// Empty string means "no auth" — Meili 1.x accepts that in development; the
// env schema enforces a non-empty key in production. Skip the property when
// empty rather than passing undefined, which trips exactOptionalPropertyTypes.
const meili = new Meilisearch(
  env.MEILI_MASTER_KEY
    ? { host: env.MEILI_HOST, apiKey: env.MEILI_MASTER_KEY }
    : { host: env.MEILI_HOST },
);

export { meili };

export async function closeMeili(): Promise<void> {
  // The JS SDK doesn't hold persistent sockets — nothing to close. Function
  // exists so callers can wire it next to other close hooks if future SDK
  // versions add pooling.
}
