import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { DocsData, GenerateInput } from './types.js';

/**
 * Fetch every input the section renderers need. Site settings is always
 * queried (the header line needs siteName + siteUrl); content types is always
 * queried because two sections derive from it (Content with its selected
 * subset, Submissions with the open-for-submission subset); menus is fetched
 * only when the Menus section is selected.
 *
 * Three parallel queries — content types per tenant are typically <100 rows
 * so loading them all is cheaper than per-id round trips.
 */
export async function loadDocsData(
  tenantId: string | null,
  input: GenerateInput,
): Promise<DocsData> {
  const tenantWhereSettings =
    tenantId === null
      ? isNull(schema.siteSettings.tenantId)
      : eq(schema.siteSettings.tenantId, tenantId);
  const tenantWhereContentTypes =
    tenantId === null
      ? isNull(schema.contentTypes.tenantId)
      : eq(schema.contentTypes.tenantId, tenantId);
  const tenantWhereMenus =
    tenantId === null
      ? isNull(schema.menus.tenantId)
      : eq(schema.menus.tenantId, tenantId);

  const [settingsRow, allContentTypes, menus] = await Promise.all([
    db
      .select({
        siteName: schema.siteSettings.siteName,
        siteUrl: schema.siteSettings.siteUrl,
      })
      .from(schema.siteSettings)
      .where(tenantWhereSettings)
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: schema.contentTypes.id,
        slug: schema.contentTypes.slug,
        name: schema.contentTypes.name,
        description: schema.contentTypes.description,
        submissionAccess: schema.contentTypes.submissionAccess,
        fieldDefinitions: schema.contentTypes.fieldDefinitions,
      })
      .from(schema.contentTypes)
      .where(tenantWhereContentTypes)
      .orderBy(asc(schema.contentTypes.name)),
    input.sections.menus.include
      ? db
          .select({
            slug: schema.menus.slug,
            name: schema.menus.name,
          })
          .from(schema.menus)
          .where(and(tenantWhereMenus, eq(schema.menus.isActive, true)))
          .orderBy(asc(schema.menus.name))
      : Promise.resolve([] as Array<{ slug: string; name: string }>),
  ]);

  const siteName = settingsRow?.siteName ?? 'Your Site';
  const siteUrl = settingsRow?.siteUrl ?? '';
  const baseUrl = siteUrl
    ? `${siteUrl.replace(/\/+$/, '')}/api/public`
    : '/api/public';

  const selectedIds = new Set(input.sections.content.contentTypeIds);
  const contentTypes = input.sections.content.include
    ? allContentTypes.filter((t) => selectedIds.has(t.id))
    : [];

  const openSubmissionTypes = allContentTypes.filter(
    (t) => t.submissionAccess !== 'none',
  );

  return {
    siteName,
    siteUrl,
    baseUrl,
    contentTypes,
    openSubmissionTypes,
    menus,
  };
}
