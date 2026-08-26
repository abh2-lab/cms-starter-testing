import type { BlockField, BlockKind, TemplateBlock, TemplateRole } from '@cms/blocks';

// The normalized input to gen:block. `kind` is always set ('standalone' when
// the caller omits it) and fields/options always present (possibly empty), so
// the codegen never has to re-handle defaults.
export interface BlockSpec {
  key: string;
  kind: BlockKind;
  label: string;
  category: string;
  description?: string;
  icon?: string;
  fields: BlockField[];
  options: BlockField[];
  // Lazy-load the Vue render half via defineAsyncComponent — set this for
  // tiptap-heavy blocks (rich-text bodies) to keep them off non-article bundles.
  lazy: boolean;
}

// The normalized input to gen:template. `role` decides the target: a part role
// (header/footer/sidebar) → packages/blocks/src/parts; any other role → a
// role-resolved template (+ a resolve-template.ts wiring TODO); no role → a
// plain page template in the admin "+New Page" set. `version` defaults to 1.
export interface TemplateSpec {
  key: string;
  name: string;
  description?: string;
  previewImage?: string;
  role?: TemplateRole;
  version: number;
  blocks: TemplateBlock[];
}
