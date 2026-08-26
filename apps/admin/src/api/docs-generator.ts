import { apiFetch } from '@/lib/api';

export type SubmissionAccess = 'none' | 'authenticated' | 'public';

export interface DocsContentType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  submissionAccess: SubmissionAccess;
}

export interface DocsMenu {
  slug: string;
  name: string;
}

export interface DocsSectionsResponse {
  siteName: string;
  siteUrl: string;
  contentTypes: DocsContentType[];
  menus: DocsMenu[];
  hasSubmissionsEnabled: boolean;
  webhookEvents: string[];
}

export interface DocsGenerateInput {
  mode: 'readable' | 'compact';
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

export interface DocsGenerateResponse {
  markdown: string;
  filename: string;
}

export const docsGeneratorApi = {
  sections: () =>
    apiFetch<{ data: DocsSectionsResponse }>('/admin/docs/sections'),
  generate: (input: DocsGenerateInput) =>
    apiFetch<{ data: DocsGenerateResponse }>('/admin/docs/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
