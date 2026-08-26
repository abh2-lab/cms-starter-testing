import { defineConfig } from 'drizzle-kit';

const directUrl = process.env.DIRECT_DATABASE_URL;

if (!directUrl) {
  throw new Error(
    'DIRECT_DATABASE_URL is required to run drizzle-kit.\n' +
      'Set it to a direct (non-pooled) Postgres connection string.\n' +
      'PgBouncer in transaction pooling mode cannot safely run migrations (DDL + prepared statements).\n' +
      'See .env.example for the local-dev default.',
  );
}

// Schema points at the compiled output (./dist) rather than ./src. drizzle-kit's
// embedded TS loader struggles with ESM cross-imports that use the required-by-Node
// `.js` extension. Building first sidesteps that — db:generate runs `tsc` before
// drizzle-kit so dist/schema is fresh.
export default defineConfig({
  schema: './dist/schema/index.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: directUrl,
  },
  strict: true,
  verbose: true,
});
