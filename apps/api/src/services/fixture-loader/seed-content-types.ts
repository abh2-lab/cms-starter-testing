import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { FieldDefinition, SubFieldDefinition } from '@cms/types';
import type { SlugResolver } from './resolve.js';
import type { ContentTypeFixture } from './schemas.js';

// Policy: structure-fixture-owned. Re-running with a changed fixture pushes
// the new field shape / settings / previewPath into the existing row. We
// emit only "newly inserted" counts so a clean-tenant run reports N and a
// re-run reports 0 — even though the UPDATE branch may have mutated rows.

export async function seedContentTypes(args: {
  tenantId: string;
  fixtures: ContentTypeFixture[];
  resolver: SlugResolver;
}): Promise<{ contentTypes: number }> {
  let inserted = 0;

  for (const fixture of args.fixtures) {
    const fieldDefinitions = {
      fields: fixture.fields.map((f, i): FieldDefinition => ({
        id: randomUUID(),
        name: f.name,
        label: f.label,
        type: f.type,
        required: f.required,
        order: i,
        ...(f.helpText !== undefined ? { helpText: f.helpText } : {}),
        ...(f.validations !== undefined ? { validations: f.validations } : {}),
        ...(f.default !== undefined ? { default: f.default } : {}),
        ...(f.subFields !== undefined
          ? {
              subFields: f.subFields.map((sf): SubFieldDefinition => ({
                id: randomUUID(),
                name: sf.name,
                label: sf.label,
                type: sf.type,
                ...(sf.required !== undefined ? { required: sf.required } : {}),
                ...(sf.options !== undefined ? { options: sf.options } : {}),
              })),
            }
          : {}),
      })),
    };

    // When a fixture opens public submissions but doesn't say what it collects,
    // default it to information-collection (matches the admin default) so
    // fixture/CLI-created submission types render as a data table, not posts.
    const settings: Record<string, unknown> = { ...fixture.settings };
    if (
      fixture.submissionAccess !== 'none' &&
      settings['submissionKind'] === undefined
    ) {
      settings['submissionKind'] = 'information';
    }

    const insertValues = {
      tenantId: args.tenantId,
      name: fixture.name,
      slug: fixture.slug,
      ...(fixture.description !== undefined
        ? { description: fixture.description }
        : {}),
      ...(fixture.icon !== undefined ? { icon: fixture.icon } : {}),
      fieldDefinitions,
      settings,
      ...(fixture.previewPath !== undefined && fixture.previewPath !== null
        ? { previewPath: fixture.previewPath }
        : {}),
      submissionAccess: fixture.submissionAccess,
    };

    const insertResult = await db
      .insert(schema.contentTypes)
      .values(insertValues)
      .onConflictDoNothing({
        target: [schema.contentTypes.tenantId, schema.contentTypes.slug],
      })
      .returning({
        id: schema.contentTypes.id,
        slug: schema.contentTypes.slug,
      });

    if (insertResult.length > 0) {
      inserted += 1;
      const row = insertResult[0]!;
      args.resolver.primeContentType(row.slug, row.id);
      continue;
    }

    // Existing row — apply the structural updates and resolve its id.
    const updateResult = await db
      .update(schema.contentTypes)
      .set({
        name: fixture.name,
        ...(fixture.description !== undefined
          ? { description: fixture.description }
          : {}),
        ...(fixture.icon !== undefined ? { icon: fixture.icon } : {}),
        fieldDefinitions,
        settings,
        // previewPath is intentionally allowed to clear back to null when the
        // fixture sets it to null (vs omitted == leave-as-is).
        ...(fixture.previewPath !== undefined
          ? { previewPath: fixture.previewPath }
          : {}),
        submissionAccess: fixture.submissionAccess,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(schema.contentTypes.tenantId, args.tenantId),
          eq(schema.contentTypes.slug, fixture.slug),
        ),
      )
      .returning({
        id: schema.contentTypes.id,
        slug: schema.contentTypes.slug,
      });

    if (updateResult.length === 0) {
      throw new Error(
        `seed-content-types: row "${fixture.slug}" vanished between insert-attempt and update`,
      );
    }
    const row = updateResult[0]!;
    args.resolver.primeContentType(row.slug, row.id);
  }

  return { contentTypes: inserted };
}
