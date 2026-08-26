import type { TemplateMeta, TemplateRole } from '../types.js';
import { DEFAULT_POST_TEMPLATE_KEY } from '../post-templates.js';
import { singleArticle } from './single.js';
import { singlePortfolio } from './single-portfolio.js';
import { archiveDefault } from './archive.js';
import { archiveCategory } from './archive-category.js';
import { archiveTag } from './archive-tag.js';
import { searchTemplate } from './search.js';
import { notFoundTemplate } from './not-found.js';
import { authorsTemplate } from './authors.js';
import { contactTemplate } from './contact.js';

// The template hierarchy — the ONE place template SELECTION happens. ALL
// "by category / by type" conditions live HERE (architecture rule #7), never
// inside blocks or templates, so templates stay pure declarative data that v2
// can serialize/override.
//
// v1 implements the `single` precedence (its only production caller is
// public/content.ts) and returns the `archive` default; other roles are
// reserved. The category arm is RESERVED, not implemented: the signature
// already accepts the taxonomy so v2 can add per-category selection as a
// one-function change, not an architecture change.

export interface ResolveTemplateInput {
  role: TemplateRole;
  // Per-post override (content.template_key).
  templateKey?: string | null;
  // Per-type default (content_types.settings.templates.default).
  typeDefaultKey?: string | null;
  // RESERVED for v2 per-category selection — accepted, not yet used.
  primaryCategorySlug?: string | null;
  taxonomySlug?: string | null;
}

export interface ResolvedTemplate {
  // For `single`, the resolved post-template KEY the theme maps to a layout
  // variant (decode/nyt). For other roles, the chosen template's own key.
  // Always a string.
  key: string;
  // The declarative block-tree to compose.
  template: TemplateMeta;
}

function firstNonEmpty(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

export function resolveTemplate(input: ResolveTemplateInput): ResolvedTemplate {
  switch (input.role) {
    case 'single': {
      // per-post override → per-type default → built-in default.
      // TODO(v2): a per-category arm slots in BEFORE the type default, keyed on
      // input.primaryCategorySlug — intentionally out of v1 scope.
      const key =
        firstNonEmpty(input.templateKey, input.typeDefaultKey) ??
        DEFAULT_POST_TEMPLATE_KEY;
      // The portfolio type sets its per-type default to `single-portfolio`
      // (content_types.settings.templates.default), which selects the isolated
      // portfolio tree — rendered by the theme's PortfolioView, not ArticleView.
      // Every other single post keeps the article tree: article-standard and
      // article-feature share it, the key only driving ArticleView's CSS
      // variant (resolvePostTemplateVariant).
      if (key === singlePortfolio.key) {
        return { key, template: singlePortfolio };
      }
      return { key, template: singleArticle };
    }
    case 'archive': {
      // Category vs tag archives are structurally different views (sidebar
      // manifesto layout vs dark hash-tag hero) — the browsed taxonomy picks
      // the variant. Any other/unknown taxonomy falls back to the generic
      // archive template. Still the only place this condition lives.
      if (input.taxonomySlug === 'tags') {
        return { key: archiveTag.key, template: archiveTag };
      }
      if (input.taxonomySlug === 'categories') {
        return { key: archiveCategory.key, template: archiveCategory };
      }
      return { key: archiveDefault.key, template: archiveDefault };
    }
    // System pages (theme engine v2 Phase 4) — each role has exactly one code
    // template, overridable per-install like the archive/single ones.
    case 'search':
      return { key: searchTemplate.key, template: searchTemplate };
    case '404':
      return { key: notFoundTemplate.key, template: notFoundTemplate };
    case 'authors':
      return { key: authorsTemplate.key, template: authorsTemplate };
    case 'contact':
      return { key: contactTemplate.key, template: contactTemplate };
    // home/page render from stored page blocks (not a code template) in v1;
    // header/footer parts are reserved. Fall back to a safe template so callers
    // never get null.
    default:
      return { key: archiveDefault.key, template: archiveDefault };
  }
}
