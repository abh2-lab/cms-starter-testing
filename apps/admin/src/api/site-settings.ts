import { apiFetch } from '@/lib/api';

export interface SiteSettings {
  id: string;
  tenantId: string | null;
  siteName: string;
  siteUrl: string;
  siteDescription: string | null;
  logoKey: string | null;
  faviconKey: string | null;
  defaultOgImageKey: string | null;
  // Resolved display URLs for the keys above (present on GET; PUT echoes the raw row).
  logoUrl?: string | null;
  faviconUrl?: string | null;
  ogImageUrl?: string | null;
  contactEmail: string | null;
  socialLinks: Record<string, unknown> | null;
  defaultMetaTitleSuffix: string | null;
  defaultRobots: string;
  googleSiteVerification: string | null;
  analyticsId: string | null;
  commentsEnabled: boolean;
  registrationEnabled: boolean;
  maintenanceMode: boolean;
  customHeadScripts: string | null;
  customBodyScripts: string | null;
  extra: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SiteSettingsInput {
  siteName: string;
  siteUrl: string;
  siteDescription?: string | null;
  logoKey?: string | null;
  faviconKey?: string | null;
  defaultOgImageKey?: string | null;
  contactEmail?: string | null;
  socialLinks?: Record<string, unknown> | null;
  defaultMetaTitleSuffix?: string | null;
  defaultRobots?: string;
  googleSiteVerification?: string | null;
  analyticsId?: string | null;
  commentsEnabled?: boolean;
  registrationEnabled?: boolean;
  maintenanceMode?: boolean;
  customHeadScripts?: string | null;
  customBodyScripts?: string | null;
  extra?: Record<string, unknown> | null;
}

export const siteSettingsApi = {
  get: () => apiFetch<{ data: SiteSettings | null }>('/admin/site-settings'),
  put: (input: SiteSettingsInput) =>
    apiFetch<{ data: SiteSettings }>('/admin/site-settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
};
