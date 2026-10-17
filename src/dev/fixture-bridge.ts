import { setFixtureDesktopApi } from "@/lib/electron";
import type { DesktopApi } from "@/types/ide";
import {
  createDesktopMethods,
  DESKTOP_METHODS,
  type DesktopMethod,
} from "../../electron/shared/desktop-channels.js";

// This bridge is installed before importing any feature modules. It replaces
// even a real Electron preload on the fixture page and never calls IPC: it
// is the same `window.dream` the preload builds (shared/desktop-channels.js),
// over a transport that answers the few methods fixtures use.
const screenshots = new Set<() => void>();
const calls: { operation: string; value: unknown }[] = [];
const preferences = { theme: "dark" as "dark" | "light" | "system" };

const answers: Partial<
  Record<DesktopMethod, (payload: Record<string, unknown>) => unknown>
> = {
  captureAppScreenshot: async () => ({
    filePath: "/fixture/screenshot.png",
    status: "saved",
  }),
  getThemePreferences: async () => ({ ...preferences }),
  setThemePreference: async ({ theme }) => {
    preferences.theme = theme as typeof preferences.theme;
    return true;
  },
  showScreenshotInFolder: async ({ path }) => {
    calls.push({ operation: "showScreenshotInFolder", value: path });
    return true;
  },
};

const methodOfChannel = new Map(
  Object.entries(DESKTOP_METHODS).map(([method, spec]) => [
    spec.channel,
    method as DesktopMethod,
  ]),
);

// Unsupported desktop methods deliberately throw when called.
const unavailable = (channel: string): never => {
  throw new Error(
    `Desktop operation ${methodOfChannel.get(channel) ?? channel} is unavailable in fixtures.`,
  );
};

const fixtureApi = {
  apiSessionToken: "fixture-no-api-access",
  initialThemePreferences: preferences,
  isElectron: true,
  ...createDesktopMethods({
    invoke: (channel, payload) => {
      const method = methodOfChannel.get(channel);
      const answer = method ? answers[method] : undefined;
      return answer
        ? answer((payload ?? {}) as Record<string, unknown>)
        : unavailable(channel);
    },
    send: (channel) => unavailable(channel),
    subscribe: (channel, listener) => {
      if (channel !== DESKTOP_METHODS.onAppScreenshotRequested.channel) {
        return unavailable(channel);
      }
      const onScreenshot = () => listener(undefined);
      screenshots.add(onScreenshot);
      return () => {
        screenshots.delete(onScreenshot);
      };
    },
  }),
} as unknown as DesktopApi;

export const installFixtureBridge = () => {
  setFixtureDesktopApi(fixtureApi);
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      location.href,
    );
    if (/^\/api(?:\/|$)/.test(url.pathname)) {
      return Promise.reject(
        new Error("Live API requests are blocked in fixtures."),
      );
    }
    return originalFetch(input, init);
  };
};

export const fixtureDesktop = {
  calls,
  screenshot: () => {
    for (const listener of screenshots) listener();
  },
};
