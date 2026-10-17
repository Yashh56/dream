// @ts-check
// The saved theme preferences, as the main process keeps them: read from
// the database once, then held here. This process is the only one that
// changes them, and a change is written by the save worker, so the main
// thread never waits on SQLite for them again. The rules (what is valid,
// the defaults, the window's background) are shared/theme-preferences.js.
import {
  DEFAULT_THEME_PREFERENCES,
  isAccentColor,
  isBaseColor,
  isThemePreference,
  normalizeThemePreferences,
  windowBackground,
} from "./shared/theme-preferences.js";

/** @typedef {import("./shared/theme-preferences.js").ThemePreferences} ThemePreferences */

/**
 * @param {object} options
 * @param {() => unknown} options.load Reads the saved preferences.
 * @param {(preferences: ThemePreferences) => void} options.save Writes them.
 */
export const createThemeStore = ({ load, save }) => {
  /** @type {ThemePreferences | null} */
  let preferences = null;

  /** @returns {ThemePreferences} */
  const get = () => {
    if (preferences) return preferences;
    try {
      preferences = normalizeThemePreferences(load());
      return preferences;
    } catch {
      // Not cached: the next read tries the database again.
      return { ...DEFAULT_THEME_PREFERENCES };
    }
  };

  return {
    get,

    /**
     * Changes the given preferences and saves them. A value that is not
     * valid leaves its preference as it is.
     * @param {{ theme?: unknown, baseColor?: unknown, accentColor?: unknown }} change
     * @returns {ThemePreferences}
     */
    update: ({ accentColor, baseColor, theme }) => {
      const current = get();
      preferences = {
        accentColor: isAccentColor(accentColor)
          ? accentColor
          : current.accentColor,
        baseColor: isBaseColor(baseColor) ? baseColor : current.baseColor,
        theme: isThemePreference(theme) ? theme : current.theme,
      };
      save(preferences);
      return preferences;
    },

    /**
     * The window's background for the current preferences.
     * @param {boolean} systemPrefersDark
     */
    windowBackground: (systemPrefersDark) =>
      windowBackground(get(), systemPrefersDark),
  };
};
