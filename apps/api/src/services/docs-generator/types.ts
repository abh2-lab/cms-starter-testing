import type { FieldDefinitions } from '@cms/types';

export type Mode = 'readable' | 'compact';

// Subset of content_types row needed for documentation.
export interface ContentTypeForDocs {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  submissionAccess: 'none' | 'authenticated' | 'public';
  fieldDefinitions: FieldDefinitions;
}

export interface MenuForDocs {
  slug: string;
  name: string;
}

// Generation request body shape. Validated with Zod in the route file.
export interface GenerateInput {
  mode: Mode;
  sections: {
    content: { include: boolean; contentTypeIds: string[] };
    taxonomy: { include: boolean };
    menus: { include: boolean };
    settings: { include: boolean };
    webhooks: { include: boolean };
    search: { include: boolean };
    submissions: { include: boolean };
  };
}

// Resolved data bundle the section renderers consume.
//
// contentTypes is pre-filtered to the user's selection so the Content section
// can iterate it directly. openSubmissionTypes is filtered independently from
// the FULL tenant set by submissionAccess so the Submissions section can list
// every type that accepts submissions, regardless of what the user picked
// under Content. (A user might want Submissions docs without Content docs.)
//
// siteUrl is the empty string when no site_settings row exists; the renderers
// fall back to a relative `/api/public` and a placeholder note in the header.
export interface DocsData {
  siteName: string;
  siteUrl: string;
  baseUrl: string;
  contentTypes: ContentTypeForDocs[];
  openSubmissionTypes: ContentTypeForDocs[];
  menus: MenuForDocs[];
}

// Shape returned by GET /api/admin/docs/sections — drives the selector UI.
export interface SectionsResponse {
  siteName: string;
  siteUrl: string;
  contentTypes: Array<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    submissionAccess: 'none' | 'authenticated' | 'public';
  }>;
  menus: MenuForDocs[];
  hasSubmissionsEnabled: boolean;
  webhookEvents: string[];
}
