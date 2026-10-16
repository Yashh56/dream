import type { ProjectConfig } from "@/types/ide";
import type { FileEditorSessions } from "../file-editor-session";
import { DEFAULT_GIT_PANEL_TAB } from "../ide-types";
import { resolveProjectFilePath } from "../project-file-path";
import { updateProjectUiInList } from "./helpers";
import type { IdeState, IdeStoreGet, IdeStoreSet } from "./ide-store-types";

export const createPanelActions = (
  set: IdeStoreSet,
  get: IdeStoreGet,
  { fileEditor }: { fileEditor: FileEditorSessions },
): Pick<
  IdeState,
  | "togglePanel"
  | "setPanelSizes"
  | "setProjectPanelSizes"
  | "setProjectChatHistoryPanelOpen"
  | "setProjectGitPanelTab"
  | "setProjectRightPanelOpen"
  | "setProjectRightPanelView"
  | "setAppView"
  | "openProjectFile"
  | "openProjectFileSearch"
  | "setOutputPanelOpen"
> => ({
  togglePanel: (panel) => {
    if (panel === "middle") {
      return;
    }

    set((state) => {
      if (panel === "left") {
        const projectId = state.activeProjectId;
        const project = state.projects.find((item) => item.id === projectId);
        const currentOpen = project?.ui.chatHistoryPanelOpen ?? false;
        const nextOpen = !currentOpen;

        return {
          projects: projectId
            ? updateProjectUiInList(state.projects, projectId, (item) => ({
                ...item.ui,
                chatHistoryPanelOpen: nextOpen,
              }))
            : state.projects,
        };
      }

      const projectId = state.activeProjectId;
      const project = state.projects.find((item) => item.id === projectId);
      const currentOpen = project?.ui.rightPanelOpen ?? false;
      const nextOpen = !currentOpen;

      return {
        projects: projectId
          ? updateProjectUiInList(state.projects, projectId, (item) => ({
              ...item.ui,
              rightPanelOpen: nextOpen,
            }))
          : state.projects,
      };
    });
  },

  setPanelSizes: (updater) => {
    set((state) => {
      const projectId = state.activeProjectId;
      const project = state.projects.find((item) => item.id === projectId);
      if (!projectId || !project) {
        return state;
      }
      const panelSizes =
        typeof updater === "function"
          ? updater(project.ui.panelSizes)
          : updater;

      return {
        projects: updateProjectUiInList(state.projects, projectId, (item) => ({
          ...item.ui,
          panelSizes,
        })),
      };
    });
  },

  setProjectPanelSizes: (projectId, updater) => {
    set((state) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        return state;
      }
      const panelSizes =
        typeof updater === "function"
          ? updater(project.ui.panelSizes)
          : updater;

      return {
        projects: updateProjectUiInList(state.projects, projectId, (item) => ({
          ...item.ui,
          panelSizes,
        })),
      };
    });
  },

  setProjectChatHistoryPanelOpen: (projectId, open) => {
    set((state) => ({
      projects: updateProjectUiInList(state.projects, projectId, (project) => ({
        ...project.ui,
        chatHistoryPanelOpen: open,
      })),
    }));
  },

  setProjectGitPanelTab: (projectId, tab) => {
    set((state) => {
      if (
        (state.projectGitPanelTabByProject[projectId] ??
          DEFAULT_GIT_PANEL_TAB) === tab
      ) {
        return state;
      }

      return {
        projectGitPanelTabByProject: {
          ...state.projectGitPanelTabByProject,
          [projectId]: tab,
        },
      };
    });
  },

  setProjectRightPanelOpen: (projectId, open) => {
    set((state) => {
      const shouldUpdateProjects = state.projects.some(
        (project) =>
          project.id === projectId && project.ui.rightPanelOpen !== open,
      );
      const shouldUpdateClosedProjects = state.closedProjects.some(
        (project) =>
          project.id === projectId && project.ui.rightPanelOpen !== open,
      );

      if (!shouldUpdateProjects && !shouldUpdateClosedProjects) {
        return state;
      }

      const projectUpdater = (project: ProjectConfig) => ({
        ...project.ui,
        rightPanelOpen: open,
      });
      const nextState: Partial<IdeState> = {};

      if (shouldUpdateProjects) {
        nextState.projects = updateProjectUiInList(
          state.projects,
          projectId,
          projectUpdater,
        );
      }

      if (shouldUpdateClosedProjects) {
        nextState.closedProjects = updateProjectUiInList(
          state.closedProjects,
          projectId,
          projectUpdater,
        );
      }

      return Object.keys(nextState).length > 0 ? nextState : state;
    });
  },

  setProjectRightPanelView: (projectId, view) => {
    set((state) => {
      const shouldUpdateProjects = state.projects.some(
        (project) =>
          project.id === projectId && project.ui.rightPanelView !== view,
      );
      const shouldUpdateClosedProjects = state.closedProjects.some(
        (project) =>
          project.id === projectId && project.ui.rightPanelView !== view,
      );

      if (!shouldUpdateProjects && !shouldUpdateClosedProjects) {
        return state;
      }

      const projectUpdater = (project: ProjectConfig) => ({
        ...project.ui,
        rightPanelView: view,
      });
      const nextState: Partial<IdeState> = {};

      if (shouldUpdateProjects) {
        nextState.projects = updateProjectUiInList(
          state.projects,
          projectId,
          projectUpdater,
        );
      }

      if (shouldUpdateClosedProjects) {
        nextState.closedProjects = updateProjectUiInList(
          state.closedProjects,
          projectId,
          projectUpdater,
        );
      }

      return Object.keys(nextState).length > 0 ? nextState : state;
    });
  },

  setAppView: (appView) => set({ appView }),

  openProjectFile: (projectId, filePath, position) => {
    const project = get().projects.find((item) => item.id === projectId);
    // However the caller named it, the file opens under one path: relative
    // to the project. A path outside the project does not open here.
    const path = project
      ? resolveProjectFilePath(project.path, filePath)
      : null;
    if (!project || !path) {
      return false;
    }

    fileEditor.session(project.id).open(path, { position });
    set((state) => ({
      projects: updateProjectUiInList(state.projects, project.id, (item) => ({
        ...item.ui,
        rightPanelOpen: true,
        rightPanelView: "explorer",
      })),
    }));
    return true;
  },

  openProjectFileSearch: (projectId) => {
    set((state) => {
      if (!state.projects.some((project) => project.id === projectId)) {
        return state;
      }

      return {
        projectFileSearchRequests: {
          ...state.projectFileSearchRequests,
          [projectId]: (state.projectFileSearchRequests[projectId] ?? 0) + 1,
        },
        projects: updateProjectUiInList(
          state.projects,
          projectId,
          (project) => ({
            ...project.ui,
            rightPanelOpen: true,
            rightPanelView: "explorer",
          }),
        ),
      };
    });
  },

  setOutputPanelOpen: (open) => set({ outputPanelOpen: open }),
});
