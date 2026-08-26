// Theme tokens (theme engine v2.0) — the theme.json-style declaration of the
// design tokens the default theme exposes. Each entry maps a stable token
// name to the CSS custom property that implements it in
// apps/web/themes/default/app/assets/css/theme.css (a vitest there asserts
// the two never drift). v2.0 ships the FILE + TYPES only — no picker UI;
// the v3 style editor and future token-aware blocks consume this.
//
// Scope note (deliberate): these cover exactly what theme.css declares as
// custom properties. The Decode chrome's dark-section hexes (#121212 etc.)
// are literals in component CSS today, not tokens — promoting them is v3
// work, not a v2.0 mapping exercise.

export interface ThemeTokenEntry {
  // The CSS custom property implementing this token in the theme layer.
  cssVar: `--${string}`;
  // The default value as declared in theme.css (drift-tested).
  value: string;
  // Human label for the (future) style UI.
  label: string;
  description?: string;
}

export interface ThemeTokens {
  version: number;
  colors: Record<string, ThemeTokenEntry>;
  // Reserved for v3: theme.css declares no typography custom properties yet —
  // the body/serif font stacks are literals in the theme layer. Promoting
  // them to --font-* vars is the first step of the style UI work.
  typography: Record<string, ThemeTokenEntry>;
  spacing: Record<string, ThemeTokenEntry>;
  radius: Record<string, ThemeTokenEntry>;
  shadows: Record<string, ThemeTokenEntry>;
  motion: Record<string, ThemeTokenEntry>;
  // The fixed style vocabularies structural blocks already accept (the group
  // block's selects). v3's pickers enumerate these instead of free-forming.
  presets: {
    group: {
      width: readonly string[];
      direction: readonly string[];
      background: readonly string[];
      padding: readonly string[];
      gap: readonly string[];
      tag: readonly string[];
    };
  };
}

export const themeTokens: ThemeTokens = {
  version: 1,
  colors: {
    bg: { cssVar: '--bg', value: '#faf7f4', label: 'Background' },
    surface: { cssVar: '--surface', value: '#ffffff', label: 'Surface' },
    text: { cssVar: '--text', value: '#0f2d96', label: 'Text' },
    muted: { cssVar: '--muted', value: '#5b6aa0', label: 'Muted text' },
    accent: { cssVar: '--accent', value: '#ff6a4d', label: 'Accent' },
    accentFg: {
      cssVar: '--accent-fg',
      value: '#ffffff',
      label: 'Accent foreground',
      description: 'Text/icon color rendered on top of the accent color.',
    },
    border: { cssVar: '--border', value: '#d5e3f2', label: 'Border' },
    brandBlue: { cssVar: '--brand-blue', value: '#0f2d96', label: 'Brand blue' },
    brandBlueLight: {
      cssVar: '--brand-blue-light',
      value: '#92deff',
      label: 'Brand blue (light)',
    },
    brandNavy: { cssVar: '--brand-navy', value: '#0a1a5c', label: 'Brand navy' },
  },
  typography: {},
  spacing: {
    container: {
      cssVar: '--container',
      value: '1200px',
      label: 'Container width',
      description: 'Max width of the default .container utility.',
    },
  },
  radius: {
    sm: { cssVar: '--radius-sm', value: '4px', label: 'Radius (small)' },
    md: { cssVar: '--radius', value: '6px', label: 'Radius' },
    lg: { cssVar: '--radius-lg', value: '10px', label: 'Radius (large)' },
    xl: { cssVar: '--radius-xl', value: '24px', label: 'Radius (extra large)' },
  },
  shadows: {
    default: {
      cssVar: '--shadow',
      value: '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.06)',
      label: 'Shadow',
    },
  },
  motion: {
    transition: {
      cssVar: '--transition',
      value: '0.15s ease',
      label: 'Transition',
      description: 'Default duration + easing for hover transitions.',
    },
  },
  presets: {
    group: {
      width: ['full', 'wide', 'narrow'],
      direction: ['column', 'row'],
      background: ['none', 'surface', 'muted'],
      padding: ['none', 'sm', 'md', 'lg'],
      gap: ['none', 'sm', 'md', 'lg'],
      tag: ['div', 'section', 'article'],
    },
  },
};

/** Every token entry across all categories — convenience for validators. */
export function listThemeTokenEntries(
  tokens: ThemeTokens = themeTokens,
): ThemeTokenEntry[] {
  return [
    ...Object.values(tokens.colors),
    ...Object.values(tokens.typography),
    ...Object.values(tokens.spacing),
    ...Object.values(tokens.radius),
    ...Object.values(tokens.shadows),
    ...Object.values(tokens.motion),
  ];
}
