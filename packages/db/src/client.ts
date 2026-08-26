import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@cms/config';
import * as schema from './schema/index.js';

// PgBouncer in transaction pooling mode rebalances backends per-transaction,
// so server-side prepared statements can't be reused across requests.
// prepare:false forces postgres-js to skip PREPARE and send queries as simple.
const client = postgres(env.DATABASE_URL, {
  max: 20,
  prepare: false,
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
