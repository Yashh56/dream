/** Command observation belongs to a terminal session, not its xterm view. */
import { createTerminalCommandRefresh } from "./terminal-command-refresh";
import {
  isUserTerminalInput,
  markTerminalSessionTouched,
  markTerminalSessionUntouched,
} from "./terminal-untouched";

export const createTerminalSessions = ({
  refreshProject: initialRefreshProject,
}: {
  refreshProject: (projectId: string) => void;
}) => {
  let refreshProject = initialRefreshProject;
  const sessions = new Map<
    string,
    {
      projectId: string;
      refresh: ReturnType<typeof createTerminalCommandRefresh>;
    }
  >();
  const close = (sessionId: string, settle = true) => {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    markTerminalSessionTouched(sessionId);
    if (settle) session?.refresh.flush();
    session?.refresh.dispose();
  };

  return {
    setRefreshProject(next: (projectId: string) => void) {
      refreshProject = next;
    },
    open(sessionId: string, projectId: string, untouched = false) {
      sessions.get(sessionId)?.refresh.dispose();
      sessions.set(sessionId, {
        projectId,
        refresh: createTerminalCommandRefresh({
          onSettled: () => refreshProject(projectId),
        }),
      });
      if (untouched) markTerminalSessionUntouched(sessionId);
      else markTerminalSessionTouched(sessionId);
    },
    input(sessionId: string, data: string) {
      const session = sessions.get(sessionId);
      if (!session || !isUserTerminalInput(data)) return;
      markTerminalSessionTouched(sessionId);
      session.refresh.input(data);
    },
    output(sessionId: string) {
      sessions.get(sessionId)?.refresh.output();
    },
    close,
    closeProject(projectId: string) {
      for (const [sessionId, session] of sessions) {
        if (session.projectId === projectId) close(sessionId, false);
      }
    },
  };
};

export const terminalSessions = createTerminalSessions({
  refreshProject: () => {},
});
