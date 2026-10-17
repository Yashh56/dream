import { expect, test } from "vitest";
import {
  hasActiveTerminalSessions,
  watchRendererUnload,
} from "./renderer-unload-guard";

const createTarget = () => {
  const listeners = new Map<string, () => void>();
  return {
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, listener);
    },
    fire: (type: string) => listeners.get(type)?.(),
    listeners,
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
  };
};

test("a running or open terminal is an active session", () => {
  const idle = { projectTerminalSessionIds: { p: [] }, terminalStatus: {} };
  expect(hasActiveTerminalSessions(idle)).toBe(false);
  expect(
    hasActiveTerminalSessions({ ...idle, terminalStatus: { p: "running" } }),
  ).toBe(true);
  expect(
    hasActiveTerminalSessions({
      ...idle,
      projectTerminalSessionIds: { p: ["s"] },
    }),
  ).toBe(true);
});

test("unloading stops the terminals, only when there are some", () => {
  const target = createTarget();
  let state = {
    projectTerminalSessionIds: {},
    terminalStatus: {},
  } as Parameters<typeof hasActiveTerminalSessions>[0];
  let stops = 0;
  const unwatch = watchRendererUnload({
    getState: () => state,
    stopAll: () => {
      stops += 1;
    },
    target: target as unknown as Window,
  });

  target.fire("pagehide");
  expect(stops).toBe(0);
  state = { ...state, terminalStatus: { p: "running" } };
  target.fire("pagehide");
  target.fire("beforeunload");
  expect(stops).toBe(2);

  unwatch();
  expect(target.listeners.size).toBe(0);
});
