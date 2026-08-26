import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { PageTemplateFixture } from './schemas.js';

// User-saved page templates — captures the ordered list of block_keys only
// (per the schema's "ARRANGEMENT ONLY" rule). Defaults come from the block
// manifest, not from the template row.

export async function seedPageTemplates(args: {
  tenantId: string;
  fixtures: PageTemplateFixture[];
}): Promise<{ pageTemplates: number }> {
  let inserted = 0;

  for (const tpl of args.fixtures) {
    const insertResult = await db
      .insert(schema.pageTemplates)
      .values({
        tenantId: args.tenantId,
        key: tpl.key,
        name: tpl.name,
        ...(tpl.description !== undefined
          ? { description: tpl.description }
          : {}),
        blockKeys: tpl.block_keys,
      })
      .onConflictDoNothing({
        target: [schema.pageTemplates.tenantId, schema.pageTemplates.key],
      })
      .returning({ id: schema.pageTemplates.id });

    if (insertResult.length > 0) {
      inserted += 1;
      continue;
    }

    await db
      .update(schema.pageTemplates)
      .set({
        name: tpl.name,
        ...(tpl.description !== undefined
          ? { description: tpl.description }
          : {}),
        blockKeys: tpl.block_keys,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(schema.pageTemplates.tenantId, args.tenantId),
          eq(schema.pageTemplates.key, tpl.key),
        ),
      );
  }

  return { pageTemplates: inserted };
}
