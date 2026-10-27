import { afterEach, expect, test, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { TERMINAL_COMMAND_QUIET_MS } from "../terminal-command-refresh";
import { terminalSessions } from "../terminal-session";
import type { IdeState } from "./ide-store-types";
import { createProjectLifecycleActions } from "./project-lifecycle-actions";
import { createTerminalActions } from "./terminal-actions";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  start: vi.fn(async () => ({ status: "running" })),
  stop: vi.fn(async () => true),
}));
vi.mock("@/lib/terminal-client", () => ({ terminalClient: mocks }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("store terminal actions own command observation until terminal or project closes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  terminalSessions.setRefreshProject(mocks.refresh);
  const store = createStore<IdeState>(
    () =>
      ({
        projects: [{ id: "project-a", path: "/work" }],
        closedProjects: [],
        settings: { shellPath: "" },
        projectTerminalSessionIds: {},
        activeTerminalSessionIdByProject: {},
        terminalSessionNames: {},
        terminalStatus: {},
        terminalTransport: {},
        terminalShell: {},
        nextTerminalOrdinalByProject: {},
      }) as unknown as IdeState,
  );
  store.setState({
    ...createTerminalActions(store.setState, store.getState),
    ...createProjectLifecycleActions(store.setState, store.getState),
  });

  await store.getState().addProjectTerminal("project-a");
  const first = store.getState().projectTerminalSessionIds["project-a"]?.[0];
  expect(first).toBeDefined();
  if (!first) throw new Error("terminal not created");
  terminalSessions.input(first, "\r");
  await store.getState().closeProjectTerminal("project-a", first, {
    keepRightPanelOpen: true,
  });
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith("project-a");

  await store.getState().addProjectTerminal("project-a");
  const second = store.getState().projectTerminalSessionIds["project-a"]?.[0];
  expect(second).toBeDefined();
  if (!second) throw new Error("terminal not created");
  terminalSessions.input(second, "\r");
  await store.getState().stopProjectTerminals("project-a");
  vi.advanceTimersByTime(TERMINAL_COMMAND_QUIET_MS);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
