import { useCallback } from "react";
import { findProjectForPath } from "./ide-state";
import { useIdeStore } from "./ide-store";
import { resolveProjectFilePath } from "./project-file-path";

/**
 * Opening a file a chat mentions in that chat's project. `projectPath` is the
 * chat's project folder, `filePath` the file as the agent or link named it.
 * `canOpen` is false when no open project is at that folder or the file is
 * outside it.
 */
export const useOpenProjectFile = (
  projectPath: string | null | undefined,
  filePath: string | null | undefined,
) => {
  const projectId = useIdeStore((state) =>
    projectPath
      ? (findProjectForPath(state.projects, state.activeProjectId, projectPath)
          ?.id ?? null)
      : null,
  );
  const canOpen = Boolean(
    projectId &&
      projectPath &&
      filePath &&
      resolveProjectFilePath(projectPath, filePath),
  );

  const open = useCallback(() => {
    if (projectId && filePath) {
      useIdeStore.getState().openProjectFile(projectId, filePath);
    }
  }, [filePath, projectId]);

  return { canOpen, open };
};
