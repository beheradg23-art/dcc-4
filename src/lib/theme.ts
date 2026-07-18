// App-wide appearance/theme system.
//
// Design: rather than re-skinning every hardcoded Tailwind color utility
// across the codebase (thousands of `bg-*`/`text-*`/`from-*`/`to-*`
// classes, none of which were built with theming in mind), every theme
// below (including the color washes, not just the two monochrome ones)
// is implemented with a full-viewport overlay (#theme-overlay, a plain
// sibling element declared in index.html — see index.css) that uses
// `backdrop-filter` to recolor everything rendered behind it.
//
// This is deliberately NOT a `filter` applied to <html>/<body> as an
// ancestor of the app: a CSS `filter` on an ancestor makes that ancestor
// the containing block for every `position: fixed` descendant (sidebar,
// modal/toast portals, the auth screen's centering wrapper, etc.)
// instead of the real viewport, which breaks their positioning the
// moment the page scrolls. `backdrop-filter` on a non-ancestor sibling
// gets the same "everything recolors, nothing stays hardcoded" result
// with zero layout side effects.
//   - Black & White [dark]  -> grayscale(1): every hue collapses to gray,
//               dark stays dark, light stays light.
//   - Black & White [light] -> grayscale(1) + invert(1): same
//               desaturation, then the whole luminance range flips, so
//               the near-black shell becomes a near-white one.
//   - The 4 color washes below -> sepia() + saturate() + hue-rotate(),
//               the standard recipe for tinting an entire rendered page
//               toward a target hue family (same trick behind most
//               "Instagram-style" CSS filters) while keeping every
//               existing gradient/animation intact — only the hue and
//               intensity shift, nothing stops moving.
// This module only toggles a class on <html> — the actual recoloring
// rules live in index.css, keyed off that same class, applied to
// #theme-overlay.
import React from 'react';

export type ThemeMode = 'colorful' | 'mono-dark' | 'mono-light' | 'ember' | 'blush' | 'crimson' | 'jade';

export const THEME_STORAGE_KEY = 'app_theme_v1';

export const THEME_OPTIONS: { id: ThemeMode; label: string; description: string }[] = [
  { id: 'mono-dark', label: 'Black & White Minimalism', description: 'Dark — every color desaturates to gray on a near-black shell' },
  { id: 'mono-light', label: 'Black & White Minimalism', description: 'Light — same desaturation, inverted to a near-white shell' },
  { id: 'ember', label: 'Ember Forge', description: 'Warm, fiery orange & amber wash over every screen' },
  { id: 'blush', label: 'Blush Riot', description: 'Bold, glam pink & magenta wash over every screen' },
  { id: 'crimson', label: 'Crimson Veil', description: 'Deep, moody vampiric red & black wash over every screen' },
  { id: 'jade', label: 'Jade Frost', description: 'Crisp, clean green & white wash over every screen' },
  { id: 'colorful', label: 'Colorful (Default)', description: "Akyos' full color palette" },
];

const THEME_CLASS_MAP: Record<ThemeMode, string | null> = {
  colorful: null,
  'mono-dark': 'theme-mono-dark',
  'mono-light': 'theme-mono-light',
  ember: 'theme-ember',
  blush: 'theme-blush',
  crimson: 'theme-crimson',
  jade: 'theme-jade',
};

const ALL_THEME_MODES: ThemeMode[] = ['colorful', 'mono-dark', 'mono-light', 'ember', 'blush', 'crimson', 'jade'];
const ALL_THEME_CLASSES = Object.values(THEME_CLASS_MAP).filter(Boolean) as string[];

export function isThemeMode(v: any): v is ThemeMode {
  return ALL_THEME_MODES.includes(v);
}

export function readStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(raw)) return raw;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back silently.
  }
  return 'colorful';
}

// Applies the theme class to <html>. Exported standalone (not just used
// inside the provider) so main.tsx can call it synchronously before the
// first paint, avoiding a flash of the wrong palette on load.
export function applyThemeClass(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove(...ALL_THEME_CLASSES);
  const cls = THEME_CLASS_MAP[mode];
  if (cls) root.classList.add(cls);

  // Keep the mobile browser chrome (status bar / task switcher strip) in
  // sync with whichever shell color is actually on screen, instead of
  // leaving it hardcoded to the colorful app's near-black. Every theme
  // except the light monochrome one keeps the app's near-black shell
  // (the color washes tint it, they don't invert it to a light shell).
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'mono-light' ? '#fafafa' : '#09090b');
}

export const ThemeContext = React.createContext<{
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
}>({
  theme: 'colorful',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemeMode>(() => readStoredTheme());

  const setTheme = React.useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    applyThemeClass(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // best-effort persistence only
    }
  }, []);

  // Keep <html> in sync (covers the initial mount, and any external change).
  React.useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return React.useContext(ThemeContext);
}