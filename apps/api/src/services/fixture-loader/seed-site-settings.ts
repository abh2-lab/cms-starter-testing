import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@cms/db';
import type { SlugResolver } from './resolve.js';
import type { SiteSettingsFixture } from './schemas.js';

// Policy: structure-fixture-owned, one row per tenant. The First Boot
// Experience writes minimal defaults; fixtures push the publisher-specific
// shape (siteName, social links, analytics ids, etc.).

export async function seedSiteSettings(args: {
  tenantId: string;
  fixture: SiteSettingsFixture | null;
  resolver: SlugResolver;
}): Promise<{ siteSettingsWritten: boolean }> {
  if (args.fixture === null) {
    return { siteSettingsWritten: false };
  }
  // Resolve `{$media: "..."}` sentinels everywhere in the payload — this
  // covers logo_key, favicon_key, default_og_image_key, and any nested
  // refs in social_links / extra. After the walk every value is either a
  // string (the storage_key) or its original literal — the TS type override
  // below reflects that the union with MediaSentinel is gone post-resolve.
  type ResolvedSiteSettings = Omit<
    SiteSettingsFixture,
    'logo_key' | 'favicon_key' | 'default_og_image_key'
  > & {
    logo_key?: string;
    favicon_key?: string;
    default_og_image_key?: string;
  };
  const f = args.resolver.resolveSentinels(args.fixture) as ResolvedSiteSettings;

  const insertResult = await db
    .insert(schema.siteSettings)
    .values({
      tenantId: args.tenantId,
      siteName: f.site_name,
      siteUrl: f.site_url,
      ...(f.site_description !== undefined
        ? { siteDescription: f.site_description }
        : {}),
      ...(f.logo_key !== undefined ? { logoKey: f.logo_key } : {}),
      ...(f.favicon_key !== undefined ? { faviconKey: f.favicon_key } : {}),
      ...(f.default_og_image_key !== undefined
        ? { defaultOgImageKey: f.default_og_image_key }
        : {}),
      ...(f.contact_email !== undefined
        ? { contactEmail: f.contact_email }
        : {}),
      ...(f.social_links !== undefined ? { socialLinks: f.social_links } : {}),
      ...(f.default_meta_title_suffix !== undefined
        ? { defaultMetaTitleSuffix: f.default_meta_title_suffix }
        : {}),
      defaultRobots: f.default_robots,
      ...(f.google_site_verification !== undefined
        ? { googleSiteVerification: f.google_site_verification }
        : {}),
      ...(f.analytics_id !== undefined ? { analyticsId: f.analytics_id } : {}),
      commentsEnabled: f.comments_enabled,
      registrationEnabled: f.registration_enabled,
      maintenanceMode: f.maintenance_mode,
      ...(f.custom_head_scripts !== undefined
        ? { customHeadScripts: f.custom_head_scripts }
        : {}),
      ...(f.custom_body_scripts !== undefined
        ? { customBodyScripts: f.custom_body_scripts }
        : {}),
      ...(f.extra !== undefined ? { extra: f.extra } : {}),
    })
    .onConflictDoNothing({ target: schema.siteSettings.tenantId })
    .returning({ id: schema.siteSettings.id });

  if (insertResult.length > 0) {
    return { siteSettingsWritten: true };
  }

  // Existing — push updates.
  //
  // siteUrl is deliberately NOT among them. It is per-ENVIRONMENT config, not
  // theme content: the same fixture set seeds a laptop, a staging box and
  // production, and each needs its own origin. Pushing it on every run meant a
  // routine content reseed on live silently reset the site's real domain to
  // the fixture's http://localhost:3001 — which broke every admin Preview
  // button and the editor's live-preview iframe, since resolveSiteUrl reads
  // this column and nothing else, and the resulting iframe pointed at the
  // ADMIN USER'S own machine ("localhost refused to connect", with nothing in
  // any log to explain it).
  // The insert above still sets it, so a brand-new tenant is seeded from the
  // fixture and the NOT NULL column is always satisfied. After that the value
  // belongs to whoever runs the environment, and Site Settings in the admin is
  // where it is changed.
  await db
    .update(schema.siteSettings)
    .set({
      siteName: f.site_name,
      ...(f.site_description !== undefined
        ? { siteDescription: f.site_description }
        : {}),
      ...(f.logo_key !== undefined ? { logoKey: f.logo_key } : {}),
      ...(f.favicon_key !== undefined ? { faviconKey: f.favicon_key } : {}),
      ...(f.default_og_image_key !== undefined
        ? { defaultOgImageKey: f.default_og_image_key }
        : {}),
      ...(f.contact_email !== undefined
        ? { contactEmail: f.contact_email }
        : {}),
      ...(f.social_links !== undefined ? { socialLinks: f.social_links } : {}),
      ...(f.default_meta_title_suffix !== undefined
        ? { defaultMetaTitleSuffix: f.default_meta_title_suffix }
        : {}),
      defaultRobots: f.default_robots,
      ...(f.google_site_verification !== undefined
        ? { googleSiteVerification: f.google_site_verification }
        : {}),
      ...(f.analytics_id !== undefined ? { analyticsId: f.analytics_id } : {}),
      commentsEnabled: f.comments_enabled,
      registrationEnabled: f.registration_enabled,
      maintenanceMode: f.maintenance_mode,
      ...(f.custom_head_scripts !== undefined
        ? { customHeadScripts: f.custom_head_scripts }
        : {}),
      ...(f.custom_body_scripts !== undefined
        ? { customBodyScripts: f.custom_body_scripts }
        : {}),
      ...(f.extra !== undefined ? { extra: f.extra } : {}),
      updatedAt: sql`NOW()`,
    })
    .where(eq(schema.siteSettings.tenantId, args.tenantId));

  return { siteSettingsWritten: false };
}
