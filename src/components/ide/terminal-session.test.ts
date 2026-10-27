import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TERMINAL_COMMAND_QUIET_MS } from "./terminal-command-refresh";
import { createTerminalSessions } from "./terminal-session";
import { isTerminalSessionUntouched } from "./terminal-untouched";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a session refreshes after its view detaches and output settles", () => {
  const refreshProject = vi.fn();
  const sessions = createTerminalSessions({ refreshProject });
  sessions.open("shell-a", "project-a", true);
  sessions.input("shell-a", "git checkout main\r");
  expect(isTerminalSessionUntouched("shell-a")).toBe(false);
  vi.advanceTimersByTime(TERMINAL_COMMAND_QUIET_MS - 1);
  // Output comes from the host, independently of any mounted view.
  sessions.output("shell-a");
  vi.advanceTimersByTime(TERMINAL_COMMAND_QUIET_MS - 1);
  expect(refreshProject).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refreshProject).toHaveBeenCalledExactlyOnceWith("project-a");
  sessions.close("shell-a");
});

test("closing a terminal settles pending work; removing its project cancels it", () => {
  const refreshProject = vi.fn();
  const sessions = createTerminalSessions({ refreshProject });
  sessions.open("shell-close", "project-a");
  sessions.open("shell-remove", "project-b");
  sessions.input("shell-close", "\r");
  sessions.input("shell-remove", "\r");
  sessions.close("shell-close");
  sessions.closeProject("project-b");
  vi.advanceTimersByTime(TERMINAL_COMMAND_QUIET_MS);
  expect(refreshProject).toHaveBeenCalledExactlyOnceWith("project-a");
});

test("automatic terminal responses neither touch the shell nor schedule a refresh", () => {
  const refreshProject = vi.fn();
  const sessions = createTerminalSessions({ refreshProject });
  sessions.open("shell-auto", "project-a", true);
  sessions.input("shell-auto", "\x1b[24;1R");
  sessions.output("shell-auto");
  vi.advanceTimersByTime(TERMINAL_COMMAND_QUIET_MS);
  expect(isTerminalSessionUntouched("shell-auto")).toBe(true);
  expect(refreshProject).not.toHaveBeenCalled();
  sessions.close("shell-auto");
});
