export * from './types.js';
export * from './registry.js';
export * from './themes.js';
export * from './post-templates.js';
export * from './page-layouts.js';
// NOTE: individual templates and parts are deliberately NOT re-exported by
// name. Reach them through the registry — getTemplate(), getPart(),
// getTemplatesByRole() — which is populated automatically from the files in
// src/{templates,parts}.
//
// There used to be a named re-export per role template and per part, spliced
// in by `pnpm gen:template`. Nothing outside this package ever imported one,
// and every such line made index.ts a second shared file that adding a
// template had to edit — the same merge-conflict trap registry.ts was.
// (resolve-template.ts still imports its templates directly from their own
// files: the template hierarchy is a deliberate hand-written mapping of role
// to template, not a registry lookup.)
// See docs/phase-3-versioning-and-updates-plan.md.
export {
  themeTokens,
  listThemeTokenEntries,
  type ThemeTokens,
  type ThemeTokenEntry,
} from './theme/tokens.js';
export {
  resolveTemplate,
  type ResolveTemplateInput,
  type ResolvedTemplate,
} from './templates/resolve-template.js';
