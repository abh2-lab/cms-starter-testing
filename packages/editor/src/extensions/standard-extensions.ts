import type { Extensions } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';

/**
 * The standard Tiptap extensions registered alongside the custom CMS nodes.
 * Both the admin editor and the public renderer import this exact list so the
 * document schema stays in sync. Image is intentionally absent — StarterKit
 * does not bundle it, and the custom InlineImage node is registered separately.
 * Editing-only extensions (Placeholder, slash-command) are left to the admin.
 *
 * Link and Underline are bundled inside StarterKit (v3+); we configure link
 * here to disable the openOnClick behaviour so admin clicks don't navigate.
 */
export const standardExtensions: Extensions = [
  StarterKit.configure({
    link: { openOnClick: false },
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextStyle,
  Color,
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
];
