import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ACCENT_COLORS,
  BASE_COLORS,
  DEFAULT_THEME_PREFERENCES,
  normalizeThemePreferences,
  resolveTheme,
  windowBackground,
} from "./shared/theme-preferences.js";
import { createThemeStore } from "./theme-store.js";

test("preferences from anything: each invalid one is its default", () => {
  assert.deepEqual(normalizeThemePreferences(null), DEFAULT_THEME_PREFERENCES);
  assert.deepEqual(
    normalizeThemePreferences({
      accentColor: "rose",
      baseColor: "plaid",
      theme: "system",
    }),
    { accentColor: "rose", baseColor: "zinc", theme: "system" },
  );
  assert.ok(ACCENT_COLORS.includes(DEFAULT_THEME_PREFERENCES.accentColor));
  assert.ok(BASE_COLORS.includes(DEFAULT_THEME_PREFERENCES.baseColor));
});

test("the window's background follows the resolved theme and base color", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(
    windowBackground({ baseColor: "slate", theme: "light" }, true),
    "#ffffff",
  );
  assert.equal(
    windowBackground({ baseColor: "slate", theme: "dark" }, false),
    "#020617",
  );
  for (const baseColor of BASE_COLORS) {
    assert.match(
      windowBackground({ baseColor, theme: "dark" }, false),
      /^#[0-9a-f]{6}$/,
    );
  }
});

test("the store reads once, saves each change, and keeps a valid value over an invalid one", () => {
  let reads = 0;
  const saved = [];
  const store = createThemeStore({
    load: () => {
      reads += 1;
      return { accentColor: "teal", baseColor: "stone", theme: "light" };
    },
    save: (preferences) => saved.push(preferences),
  });
  store.get();
  store.get();
  assert.equal(reads, 1);

  assert.deepEqual(store.update({ baseColor: "plaid", theme: "dark" }), {
    accentColor: "teal",
    baseColor: "stone",
    theme: "dark",
  });
  assert.deepEqual(saved, [store.get()]);
  assert.equal(store.windowBackground(false), "#0c0a09");
});

test("a failed read answers the defaults and is tried again", () => {
  let reads = 0;
  const store = createThemeStore({
    load: () => {
      reads += 1;
      if (reads === 1) throw new Error("locked");
      return { theme: "light" };
    },
    save: () => {},
  });
  assert.deepEqual(store.get(), DEFAULT_THEME_PREFERENCES);
  assert.equal(store.get().theme, "light");
});
