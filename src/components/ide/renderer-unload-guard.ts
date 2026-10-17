// The renderer's half of stopping terminals before the page goes away. A
// reload or an in-app navigation is held in the main process until they
// stop (electron/renderer-unload-guard.js); for every other way the page
// unloads, this asks the host to stop them as it goes (a keepalive request,
// which outlives the page).
import type { IdeState } from "./store/ide-store-types";

/** Whether any project has a terminal running or open. */
export const hasActiveTerminalSessions = (
  state: Pick<IdeState, "projectTerminalSessionIds" | "terminalStatus">,
): boolean =>
  Object.values(state.terminalStatus).some((status) => status === "running") ||
  Object.values(state.projectTerminalSessionIds).some(
    (sessionIds) => sessionIds.length > 0,
  );

/**
 * Stops the terminals on pagehide and beforeunload, when there are any.
 * Answers the removal of the listeners.
 */
export const watchRendererUnload = ({
  getState,
  stopAll,
  target = window,
}: {
  getState: () => Pick<
    IdeState,
    "projectTerminalSessionIds" | "terminalStatus"
  >;
  stopAll: () => unknown;
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}): (() => void) => {
  const stopActiveSessions = () => {
    if (hasActiveTerminalSessions(getState())) void stopAll();
  };

  target.addEventListener("pagehide", stopActiveSessions);
  target.addEventListener("beforeunload", stopActiveSessions);
  return () => {
    target.removeEventListener("pagehide", stopActiveSessions);
    target.removeEventListener("beforeunload", stopActiveSessions);
  };
};
