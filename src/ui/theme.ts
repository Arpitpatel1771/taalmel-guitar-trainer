// Theme and accent plumbing (specs/5-11-ui-redesign.md 2.5). Settings hold the
// preference ("system" | "dark" | "light"); <html data-theme> always holds the
// resolved mode so tokens.css only needs two modes. The same values are cached
// in localStorage so the inline script in index.html can set the attributes
// before first paint.

import { useEffect } from "react";
import { ACCENT_IDS, DEFAULT_SETTINGS, THEME_PREFS, type AccentId, type ThemePref } from "../model";

export type ResolvedTheme = "dark" | "light";

/** Keep in sync with the inline script in index.html. */
export const THEME_CACHE_KEY = "taalmel.theme";

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

/** What the rail toggle switches to: always an explicit mode, never "system". */
export function nextThemePref(pref: ThemePref, systemDark: boolean): ThemePref {
  return resolveTheme(pref, systemDark) === "dark" ? "light" : "dark";
}

export function parseThemeCache(raw: string | null): { theme: ThemePref; accent: AccentId } {
  try {
    const v = raw ? (JSON.parse(raw) as { theme?: unknown; accent?: unknown }) : {};
    return {
      theme: THEME_PREFS.includes(v.theme as ThemePref) ? (v.theme as ThemePref) : DEFAULT_SETTINGS.theme,
      accent: ACCENT_IDS.includes(v.accent as AccentId) ? (v.accent as AccentId) : DEFAULT_SETTINGS.accent,
    };
  } catch {
    return { theme: DEFAULT_SETTINGS.theme, accent: DEFAULT_SETTINGS.accent };
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

function apply(pref: ThemePref, accent: AccentId): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(pref, systemPrefersDark()));
  root.setAttribute("data-accent", accent);
}

/** Applies the settings to <html>, follows the OS live while "system", and caches them for first paint. */
export function useTheme(theme: ThemePref, accent: AccentId): void {
  useEffect(() => {
    apply(theme, accent);
    try {
      localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ theme, accent }));
    } catch {
      // Cache is a first-paint nicety only.
    }
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => apply(theme, accent);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, accent]);
}
