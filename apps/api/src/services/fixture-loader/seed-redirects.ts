import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { RedirectFixture } from './schemas.js';

// Policy: structure-fixture-owned. Re-runs push to_path / redirect_type
// changes; from_path is the stable key.

export async function seedRedirects(args: {
  tenantId: string;
  fixtures: RedirectFixture[];
}): Promise<{ redirects: number }> {
  let inserted = 0;

  for (const fixture of args.fixtures) {
    const insertResult = await db
      .insert(schema.redirects)
      .values({
        tenantId: args.tenantId,
        fromPath: fixture.from_path,
        toPath: fixture.to_path,
        redirectType: fixture.redirect_type,
        isActive: fixture.is_active,
        ...(fixture.notes !== undefined ? { notes: fixture.notes } : {}),
        autoCreated: false,
      })
      .onConflictDoNothing({
        target: [schema.redirects.tenantId, schema.redirects.fromPath],
      })
      .returning({ id: schema.redirects.id });

    if (insertResult.length > 0) {
      inserted += 1;
      continue;
    }

    await db
      .update(schema.redirects)
      .set({
        toPath: fixture.to_path,
        redirectType: fixture.redirect_type,
        isActive: fixture.is_active,
        ...(fixture.notes !== undefined ? { notes: fixture.notes } : {}),
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(schema.redirects.tenantId, args.tenantId),
          eq(schema.redirects.fromPath, fixture.from_path),
        ),
      );
  }

  return { redirects: inserted };
}
