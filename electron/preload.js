// `window.dream`: the desktop methods of shared/desktop-channels.js over
// Electron IPC, plus what the page needs before it runs (its API session
// token, and the theme preferences, applied before the first paint).
import { contextBridge, ipcRenderer } from "electron";
import {
  createDesktopMethods,
  DESKTOP_SYNC_CHANNELS,
} from "./shared/desktop-channels.js";
import {
  applyAccentColor,
  applyBaseColor,
  applyResolvedTheme,
  normalizeThemePreferences,
  resolveTheme,
} from "./shared/theme-preferences.js";

const apiSessionToken = ipcRenderer.sendSync(
  DESKTOP_SYNC_CHANNELS.apiSessionToken,
);
if (!apiSessionToken) {
  throw new Error("Missing API session token from Electron main process.");
}

const getMainThemePreferences = () => {
  try {
    // Read on every load: BrowserWindow arguments retain the original theme
    // after a reload, even when the saved preferences have since changed.
    return ipcRenderer.sendSync(DESKTOP_SYNC_CHANNELS.initialThemePreferences);
  } catch {
    return null;
  }
};

// What the page itself last stored (lib/ui-store.ts, next-themes).
const getBrowserThemePreferences = () => {
  try {
    const rawUiPreferences = window.localStorage?.getItem(
      "dream-ui-preferences",
    );
    const uiPreferences = rawUiPreferences ? JSON.parse(rawUiPreferences) : {};

    return {
      accentColor: uiPreferences?.accentColor,
      baseColor: uiPreferences?.baseColor,
      theme: window.localStorage?.getItem("dream-theme"),
    };
  } catch {
    return null;
  }
};

const initialThemePreferences = normalizeThemePreferences(
  getMainThemePreferences() ?? getBrowserThemePreferences(),
);

const applyInitialThemePreferences = () => {
  const root =
    typeof document === "undefined" ? null : document.documentElement;
  if (!root) {
    return;
  }

  applyResolvedTheme(
    root,
    resolveTheme(
      initialThemePreferences.theme,
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
    ),
  );
  applyBaseColor(root, initialThemePreferences.baseColor);
  applyAccentColor(root, initialThemePreferences.accentColor);
};

if (typeof document !== "undefined" && document.documentElement) {
  applyInitialThemePreferences();
} else {
  window.addEventListener("DOMContentLoaded", applyInitialThemePreferences, {
    once: true,
  });
}

contextBridge.exposeInMainWorld("dream", {
  isElectron: true,
  apiSessionToken,
  hostMode: ipcRenderer.sendSync(DESKTOP_SYNC_CHANNELS.hostMode),
  initialThemePreferences,
  ...createDesktopMethods({
    invoke: (channel, payload) =>
      payload === undefined
        ? ipcRenderer.invoke(channel)
        : ipcRenderer.invoke(channel, payload),
    send: (channel, payload) => ipcRenderer.send(channel, payload),
    subscribe: (channel, listener) => {
      /** @type {(event: unknown, payload: unknown) => void} */
      const subscription = (_event, payload) => {
        listener(payload);
      };
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
  }),
});
