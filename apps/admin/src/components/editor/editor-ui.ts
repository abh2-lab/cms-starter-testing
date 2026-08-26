import type { InjectionKey, Ref } from 'vue';

// Lightweight UI state shared by the structure popup, its tree nodes, and the
// left "Current blocks" list — kept out of the mutation API (useBlockTree) so
// the two concerns stay separate. `expandedId` = which card has its settings
// open (one at a time); `focusedId` = the block last clicked (highlights in
// both the popup and the list, and is what the left list "jump to" targets).
export interface EditorUi {
  expandedId: Ref<string | null>;
  focusedId: Ref<string | null>;
  focus(id: string): void; // focus + expand a block (and open the popup)
}

export const EDITOR_UI_KEY: InjectionKey<EditorUi> = Symbol('editor-ui');
