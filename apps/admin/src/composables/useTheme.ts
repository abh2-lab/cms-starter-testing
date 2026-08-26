import { readonly, ref } from 'vue';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'admin:theme';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

// Module-level singleton so every caller shares one reactive theme.
const theme = ref<Theme>(readStored() ?? (systemPrefersDark() ? 'dark' : 'light'));

function apply(value: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset['theme'] = value;
  }
}

function setTheme(value: Theme): void {
  theme.value = value;
  apply(value);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage unavailable — theme just won't persist across reloads
  }
}

function toggleTheme(): void {
  setTheme(theme.value === 'dark' ? 'light' : 'dark');
}

/** Call once at startup to set the attribute before first paint. */
export function initTheme(): void {
  apply(theme.value);
}

export function useTheme() {
  return { theme: readonly(theme), setTheme, toggleTheme };
}
