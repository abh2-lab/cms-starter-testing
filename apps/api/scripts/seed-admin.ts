/**
 * Create or update a super_admin for a given tenant.
 *
 * Usage:
 *   pnpm --filter @cms/api seed:admin --tenant=<slug> [--email=...] [--password=...] [--name=...]
 *
 * Defaults:
 *   email    = admin@<tenant-slug>.local
 *   password = test1234
 *   name     = <Tenant Slug> Admin
 *
 * Idempotent: re-running rotates the password hash, reactivates the user,
 * and reassigns the tenant binding if it changed. The tenant must already
 * exist (created by seed:fixtures, FBE, or another path).
 *
 * Unlike seed:test-admin, this script does NOT create a demo content type —
 * the admin user is the only thing it touches. Safe to run against tenants
 * that already have their own fixture-seeded CPTs.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import { hashPassword } from '../src/services/password.js';

interface Args {
  tenantSlug: string;
  email: string;
  password: string;
  displayName: string;
}

function parseArgs(argv: readonly string[]): Args {
  let tenantSlug: string | undefined;
  let email: string | undefined;
  let password = 'test1234';
  let displayName: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--tenant=')) {
      tenantSlug = arg.slice('--tenant='.length);
    } else if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
    } else if (arg.startsWith('--password=')) {
      password = arg.slice('--password='.length);
    } else if (arg.startsWith('--name=')) {
      displayName = arg.slice('--name='.length);
    } else {
      console.error(`seed:admin — unknown argument "${arg}"`);
      process.exit(1);
    }
  }

  if (!tenantSlug || tenantSlug.length === 0) {
    console.error('seed:admin — --tenant=<slug> is required');
    process.exit(1);
  }

  return {
    tenantSlug,
    email: email ?? `admin@${tenantSlug}.local`,
    password,
    displayName:
      displayName ??
      `${tenantSlug.charAt(0).toUpperCase()}${tenantSlug.slice(1)} Admin`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const [tenant] = await db
    .select({ id: schema.tenants.id, slug: schema.tenants.slug })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, args.tenantSlug))
    .limit(1);

  if (!tenant) {
    console.error(
      `seed:admin — tenant "${args.tenantSlug}" does not exist. Run seed:fixtures first to create it.`,
    );
    process.exit(1);
  }

  const hashedPassword = await hashPassword(args.password);

  const [user] = await db
    .insert(schema.adminUsers)
    .values({
      email: args.email,
      hashedPassword,
      displayName: args.displayName,
      role: 'super_admin',
      tenantId: tenant.id,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: schema.adminUsers.email,
      set: {
        hashedPassword,
        displayName: args.displayName,
        tenantId: tenant.id,
        isActive: true,
      },
    })
    .returning({
      id: schema.adminUsers.id,
      email: schema.adminUsers.email,
      role: schema.adminUsers.role,
    });

  if (!user) {
    throw new Error('seed:admin — upsert returned no row');
  }

  console.log(`
Seeded admin for tenant "${tenant.slug}":
  id       : ${user.id}
  email    : ${user.email}
  role     : ${user.role}
  display  : ${args.displayName}
Password   : ${args.password}
Log in at  : http://localhost:5173
`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('seed:admin — failed:', err);
  process.exit(1);
});
