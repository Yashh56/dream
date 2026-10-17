import { create } from "zustand";
import { getDesktopApi } from "@/lib/electron";
import type { AccentColor, BaseColor } from "@/types/ide";
import {
  ACCENT_COLORS,
  applyAccentColor as applyDocumentAccentColor,
  applyBaseColor as applyDocumentBaseColor,
  BASE_COLORS,
  DEFAULT_THEME_PREFERENCES,
  isAccentColor,
  isBaseColor,
} from "../../electron/shared/theme-preferences.js";

const UI_STORAGE_KEY = "dream-ui-preferences";
const DEFAULT_BASE_COLOR = DEFAULT_THEME_PREFERENCES.baseColor;
const DEFAULT_ACCENT_COLOR = DEFAULT_THEME_PREFERENCES.accentColor;

// The color lists and their rules are shared with the main process and the
// preload (electron/shared/theme-preferences.js).
export { ACCENT_COLORS, BASE_COLORS };

interface UiState {
  accentColor: AccentColor;
  baseColor: BaseColor;
  setAccentColor: (color: AccentColor) => void;
  setBaseColor: (color: BaseColor) => void;
  hydrateUi: () => Promise<void>;
}

function applyBaseColor(color: BaseColor) {
  if (typeof document !== "undefined") {
    applyDocumentBaseColor(document.documentElement, color);
  }
}

function applyAccentColor(color: AccentColor) {
  if (typeof document !== "undefined") {
    applyDocumentAccentColor(document.documentElement, color);
  }
}

function persistUiPreferences(preferences: {
  accentColor: AccentColor;
  baseColor: BaseColor;
}) {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // ignore
  }
}

let uiPreferenceRevision = 0;

function getInitialUiPreferences(): {
  accentColor: AccentColor;
  baseColor: BaseColor;
} {
  const preferences = getDesktopApi()?.initialThemePreferences;
  const baseColor = isBaseColor(preferences?.baseColor)
    ? preferences.baseColor
    : DEFAULT_BASE_COLOR;
  const accentColor = isAccentColor(preferences?.accentColor)
    ? preferences.accentColor
    : DEFAULT_ACCENT_COLOR;

  return { accentColor, baseColor };
}

const INITIAL_UI_PREFERENCES = getInitialUiPreferences();

export const useUiStore = create<UiState>((set, _get) => ({
  accentColor: INITIAL_UI_PREFERENCES.accentColor,
  baseColor: INITIAL_UI_PREFERENCES.baseColor,

  setAccentColor: (color) => {
    uiPreferenceRevision++;
    applyAccentColor(color);
    set({ accentColor: color });
    persistUiPreferences({
      accentColor: color,
      baseColor: useUiStore.getState().baseColor,
    });
    void getDesktopApi()?.setAccentColor(color);
  },

  setBaseColor: (color) => {
    uiPreferenceRevision++;
    applyBaseColor(color);
    set({ baseColor: color });
    persistUiPreferences({
      accentColor: useUiStore.getState().accentColor,
      baseColor: color,
    });
    void getDesktopApi()?.setBaseColor(color);
  },

  hydrateUi: async () => {
    const hydrateRevision = uiPreferenceRevision;
    const initialPreferences = getDesktopApi()?.initialThemePreferences;
    if (initialPreferences) {
      const baseColor = isBaseColor(initialPreferences.baseColor)
        ? initialPreferences.baseColor
        : DEFAULT_BASE_COLOR;
      const accentColor = isAccentColor(initialPreferences.accentColor)
        ? initialPreferences.accentColor
        : DEFAULT_ACCENT_COLOR;

      applyBaseColor(baseColor);
      applyAccentColor(accentColor);
      set({ accentColor, baseColor });
      persistUiPreferences({ accentColor, baseColor });
      return;
    }

    const desktopApi = getDesktopApi();
    if (desktopApi) {
      try {
        const preferences = await desktopApi.getThemePreferences();
        if (hydrateRevision !== uiPreferenceRevision) {
          return;
        }

        const baseColor = isBaseColor(preferences?.baseColor)
          ? preferences.baseColor
          : DEFAULT_BASE_COLOR;
        const accentColor = isAccentColor(preferences?.accentColor)
          ? preferences.accentColor
          : DEFAULT_ACCENT_COLOR;

        applyBaseColor(baseColor);
        applyAccentColor(accentColor);
        set({ accentColor, baseColor });
        persistUiPreferences({ accentColor, baseColor });

        if (!isAccentColor(preferences?.accentColor)) {
          void desktopApi.setAccentColor(accentColor);
        }
        if (!isBaseColor(preferences?.baseColor)) {
          void desktopApi.setBaseColor(baseColor);
        }

        return;
      } catch {
        // fall back to browser storage below
      }
    }

    let hydratedFromLocalStorage = false;

    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          accentColor?: unknown;
          baseColor?: unknown;
        };
        const baseColor = isBaseColor(parsed.baseColor)
          ? parsed.baseColor
          : DEFAULT_BASE_COLOR;
        const accentColor = isAccentColor(parsed.accentColor)
          ? parsed.accentColor
          : DEFAULT_ACCENT_COLOR;

        applyBaseColor(baseColor);
        applyAccentColor(accentColor);
        set({ accentColor, baseColor });
        hydratedFromLocalStorage = true;
      }
    } catch {
      // ignore
    }

    if (!hydratedFromLocalStorage) {
      applyBaseColor(DEFAULT_BASE_COLOR);
      applyAccentColor(DEFAULT_ACCENT_COLOR);
      set({
        accentColor: DEFAULT_ACCENT_COLOR,
        baseColor: DEFAULT_BASE_COLOR,
      });
    }
  },
}));
