// @ts-check
// The theme preferences (light, dark or system; a base color; an accent
// color) and how they show, stated once for every side that needs them:
//
//   the main process  keeps the saved preferences and paints the window's
//                     background before the page does (theme-store.js);
//   the preload       applies them to the document before the first paint;
//   the renderer      changes them (lib/ui-store.ts, theme-provider.tsx).
//
// index.html's inline boot script runs before any module can load and
// keeps its own copy of the defaults.

/** @typedef {import("../../src/types/ide").AccentColor} AccentColor */
/** @typedef {import("../../src/types/ide").BaseColor} BaseColor */
/** @typedef {"light" | "dark" | "system"} ThemePreference */
/** @typedef {"light" | "dark"} ResolvedTheme */

/**
 * @typedef {object} ThemePreferences
 * @property {ThemePreference} theme
 * @property {BaseColor} baseColor
 * @property {AccentColor} accentColor
 */

/** @type {readonly ThemePreference[]} */
export const THEME_PREFERENCES = ["light", "dark", "system"];

/** @type {readonly BaseColor[]} */
export const BASE_COLORS = ["neutral", "slate", "gray", "zinc", "stone"];

/** @type {readonly AccentColor[]} */
export const ACCENT_COLORS = [
  "black-white",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

/** @type {Readonly<ThemePreferences>} */
export const DEFAULT_THEME_PREFERENCES = {
  accentColor: "green",
  baseColor: "zinc",
  theme: "dark",
};

/**
 * @param {unknown} value
 * @returns {value is ThemePreference}
 */
export const isThemePreference = (value) =>
  /** @type {readonly unknown[]} */ (THEME_PREFERENCES).includes(value);

/**
 * @param {unknown} value
 * @returns {value is BaseColor}
 */
export const isBaseColor = (value) =>
  /** @type {readonly unknown[]} */ (BASE_COLORS).includes(value);

/**
 * @param {unknown} value
 * @returns {value is AccentColor}
 */
export const isAccentColor = (value) =>
  /** @type {readonly unknown[]} */ (ACCENT_COLORS).includes(value);

/**
 * Preferences from anything (a saved record, an IPC answer, local
 * storage): each one that is not valid is its default.
 * @param {unknown} value
 * @returns {ThemePreferences}
 */
export const normalizeThemePreferences = (value) => {
  const raw =
    value && typeof value === "object"
      ? /** @type {Record<string, unknown>} */ (value)
      : {};
  return {
    accentColor: isAccentColor(raw.accentColor)
      ? raw.accentColor
      : DEFAULT_THEME_PREFERENCES.accentColor,
    baseColor: isBaseColor(raw.baseColor)
      ? raw.baseColor
      : DEFAULT_THEME_PREFERENCES.baseColor,
    theme: isThemePreference(raw.theme)
      ? raw.theme
      : DEFAULT_THEME_PREFERENCES.theme,
  };
};

/**
 * @param {ThemePreference} theme
 * @param {boolean} systemPrefersDark
 * @returns {ResolvedTheme}
 */
export const resolveTheme = (theme, systemPrefersDark) =>
  theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;

const LIGHT_BACKGROUND = "#ffffff";
/** @type {Record<BaseColor, string>} */
const DARK_BACKGROUNDS = {
  gray: "#030712",
  neutral: "#0a0a0a",
  slate: "#020617",
  stone: "#0c0a09",
  zinc: "#09090b",
};

/**
 * The page's background for these preferences, for the window behind it.
 * @param {Pick<ThemePreferences, "theme" | "baseColor">} preferences
 * @param {boolean} systemPrefersDark
 * @returns {string}
 */
export const windowBackground = ({ baseColor, theme }, systemPrefersDark) =>
  resolveTheme(theme, systemPrefersDark) === "light"
    ? LIGHT_BACKGROUND
    : DARK_BACKGROUNDS[baseColor];

/**
 * Shows a resolved theme on the document: its class and color scheme.
 * @param {HTMLElement} root
 * @param {ResolvedTheme} theme
 */
export const applyResolvedTheme = (root, theme) => {
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
};

/**
 * @param {HTMLElement} root
 * @param {BaseColor} color
 */
export const applyBaseColor = (root, color) => {
  // Neutral is the stylesheet's default palette.
  if (color === "neutral") root.removeAttribute("data-base-color");
  else root.setAttribute("data-base-color", color);
};

/**
 * @param {HTMLElement} root
 * @param {AccentColor} color
 */
export const applyAccentColor = (root, color) => {
  root.setAttribute("data-accent-color", color);
};
