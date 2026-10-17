import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
  useTheme,
} from "next-themes";
import { useEffect, useRef, useState } from "react";
import { getDesktopApi, hasDesktopApi } from "@/lib/electron";
import {
  applyResolvedTheme,
  DEFAULT_THEME_PREFERENCES,
  isThemePreference,
  resolveTheme,
} from "../../electron/shared/theme-preferences.js";

const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const applyDocumentTheme = (theme: "light" | "dark" | "system") => {
  if (typeof document === "undefined") {
    return;
  }

  applyResolvedTheme(
    document.documentElement,
    resolveTheme(theme, systemPrefersDark()),
  );
};

const seedThemeStorage = (
  storageKey: ThemeProviderProps["storageKey"],
  theme: "light" | "dark" | "system",
) => {
  try {
    localStorage.setItem(
      typeof storageKey === "string" ? storageKey : "theme",
      theme,
    );
  } catch {
    // ignore
  }
};

const ElectronThemeBridge = ({
  initialTheme,
  storageKey,
}: {
  initialTheme: "light" | "dark" | "system";
  storageKey: ThemeProviderProps["storageKey"];
}) => {
  const { theme } = useTheme();
  const initialThemeSeenRef = useRef(false);

  useEffect(() => {
    if (!isThemePreference(theme)) {
      return;
    }

    if (!initialThemeSeenRef.current) {
      initialThemeSeenRef.current = true;
      if (theme === initialTheme) {
        return;
      }
    }

    const desktopApi = getDesktopApi();
    if (!desktopApi) {
      return;
    }

    seedThemeStorage(storageKey, theme);
    void desktopApi.setThemePreference(theme);
  }, [initialTheme, storageKey, theme]);

  return null;
};

export const ThemeProvider = ({ children, ...props }: ThemeProviderProps) => {
  const [desktopInitialTheme, setDesktopInitialTheme] = useState<
    "light" | "dark" | "system" | null
  >(() => {
    const desktopApi = getDesktopApi();
    const initialTheme = desktopApi?.initialThemePreferences?.theme;

    if (isThemePreference(initialTheme)) {
      seedThemeStorage(props.storageKey, initialTheme);
      return initialTheme;
    }

    return hasDesktopApi() ? null : DEFAULT_THEME_PREFERENCES.theme;
  });

  useEffect(() => {
    if (desktopInitialTheme !== null) {
      return;
    }

    const desktopApi = getDesktopApi();
    if (!desktopApi) {
      return;
    }

    let cancelled = false;

    desktopApi
      .getThemePreferences()
      .then((preferences) => {
        const theme = isThemePreference(preferences?.theme)
          ? preferences.theme
          : DEFAULT_THEME_PREFERENCES.theme;
        if (cancelled) {
          return;
        }

        applyDocumentTheme(theme);
        seedThemeStorage(props.storageKey, theme);
        setDesktopInitialTheme(theme);
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopInitialTheme(DEFAULT_THEME_PREFERENCES.theme);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktopInitialTheme, props.storageKey]);

  if (desktopInitialTheme === null) {
    return null;
  }

  return (
    <NextThemesProvider {...props} defaultTheme={desktopInitialTheme}>
      <ElectronThemeBridge
        initialTheme={desktopInitialTheme}
        storageKey={props.storageKey}
      />
      {children}
    </NextThemesProvider>
  );
};
