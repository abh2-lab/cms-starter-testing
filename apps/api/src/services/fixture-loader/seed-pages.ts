import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { PageBlockInstance } from '@cms/blocks';
import type { SlugResolver } from './resolve.js';
import type { PageFixture } from './schemas.js';

// Policy: structure-fixture-owned WHEN system_managed=true (default for
// fixture pages). Editor-owned pages (system_managed=false) get insert-only
// semantics so editor edits aren't clobbered. Block-key and template-key
// validity is already enforced upstream by validate.ts.

export async function seedPages(args: {
  tenantId: string;
  fixtures: PageFixture[];
  resolver: SlugResolver;
}): Promise<{ pages: number }> {
  let inserted = 0;

  for (const fixture of args.fixtures) {
    // Resolve `{$media: "..."}` sentinels anywhere inside block fields/options
    // and the seo payload BEFORE we snapshot them onto the page row.
    const blockInstances: PageBlockInstance[] = fixture.blocks.map((b) => ({
      id: randomUUID(),
      block_key: b.block_key,
      fields: args.resolver.resolveSentinels(b.fields) as Record<string, unknown>,
      options: args.resolver.resolveSentinels(b.options) as Record<string, unknown>,
    }));
    const resolvedSeo = args.resolver.resolveSentinels(fixture.seo) as Record<string, unknown>;

    const baseValues = {
      tenantId: args.tenantId,
      slug: fixture.slug,
      title: fixture.title,
      type: fixture.type,
      status: fixture.status,
      locale: fixture.locale,
      ...(fixture.html !== undefined && fixture.html !== null
        ? { html: fixture.html }
        : {}),
      ...(fixture.css !== undefined && fixture.css !== null
        ? { css: fixture.css }
        : {}),
      ...(fixture.template_key !== undefined && fixture.template_key !== null
        ? { templateKey: fixture.template_key }
        : {}),
      blocks: blockInstances,
      ...(fixture.layout_template !== undefined && fixture.layout_template !== null
        ? { layoutTemplate: fixture.layout_template }
        : {}),
      seo: resolvedSeo,
      systemManaged: fixture.system_managed,
      ...(fixture.publish_at !== undefined && fixture.publish_at !== null
        ? { publishAt: new Date(fixture.publish_at) }
        : {}),
      ...(fixture.published_at !== undefined && fixture.published_at !== null
        ? { publishedAt: new Date(fixture.published_at) }
        : fixture.status === 'published'
          ? { publishedAt: new Date() }
          : {}),
    };

    const insertResult = await db
      .insert(schema.pages)
      .values(baseValues)
      .onConflictDoNothing({
        target: [schema.pages.tenantId, schema.pages.slug],
      })
      .returning({ id: schema.pages.id });

    if (insertResult.length > 0) {
      inserted += 1;
      continue;
    }

    // Pre-existing page — only push updates when the fixture marks the page
    // as system-managed. Editor-owned pages are left alone.
    if (!fixture.system_managed) continue;

    await db
      .update(schema.pages)
      .set({
        title: fixture.title,
        type: fixture.type,
        status: fixture.status,
        locale: fixture.locale,
        ...(fixture.html !== undefined
          ? { html: fixture.html }
          : {}),
        ...(fixture.css !== undefined ? { css: fixture.css } : {}),
        ...(fixture.template_key !== undefined
          ? { templateKey: fixture.template_key }
          : {}),
        blocks: blockInstances,
        ...(fixture.layout_template !== undefined
          ? { layoutTemplate: fixture.layout_template }
          : {}),
        seo: resolvedSeo,
        systemManaged: fixture.system_managed,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(schema.pages.tenantId, args.tenantId),
          eq(schema.pages.slug, fixture.slug),
        ),
      );
  }

  return { pages: inserted };
}
