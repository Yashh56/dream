import type { FileEditorSessions } from "../file-editor-session";
import { DEFAULT_GIT_PANEL_TAB, type RightPanelView } from "../ide-types";
import { resolveProjectFilePath } from "../project-file-path";
import { updateProjectUiInList } from "./helpers";
import type { IdeState, IdeStoreGet, IdeStoreSet } from "./ide-store-types";

export const createPanelActions = (
  set: IdeStoreSet,
  get: IdeStoreGet,
  { fileEditor }: { fileEditor: FileEditorSessions },
): Pick<
  IdeState,
  | "setPanelSizes"
  | "setProjectPanelSizes"
  | "setProjectChatHistoryPanelOpen"
  | "setProjectGitPanelTab"
  | "showRightPanelView"
  | "closeRightPanel"
  | "toggleRightPanel"
  | "setAppView"
  | "openProjectFile"
  | "openProjectFileSearch"
  | "setOutputPanelOpen"
> => {
  /** Writes an open project's right-panel fields, if they change. */
  const setRightPanel = (
    projectId: string,
    ui: { rightPanelOpen: boolean; rightPanelView?: RightPanelView },
  ) => {
    set((state) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (
        !project ||
        (project.ui.rightPanelOpen === ui.rightPanelOpen &&
          (ui.rightPanelView === undefined ||
            project.ui.rightPanelView === ui.rightPanelView))
      ) {
        return state;
      }
      return {
        projects: updateProjectUiInList(state.projects, projectId, (item) => ({
          ...item.ui,
          ...ui,
        })),
      };
    });
  };

  // ── Right-panel navigation ────────────────────────────────────────
  // The only writers of what a project's right panel shows: every rule that
  // goes with showing or leaving a view is applied here, whoever asks.

  const closeRightPanel = (projectId: string) => {
    const project = get().projects.find((item) => item.id === projectId);
    if (!project) return;
    if (project.ui.rightPanelView === "terminal") {
      get().discardUntouchedTerminals(projectId);
    }
    setRightPanel(projectId, { rightPanelOpen: false });
  };

  const showRightPanelView: IdeState["showRightPanelView"] = (
    projectId,
    view,
    options = {},
  ) => {
    const state = get();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;

    const { rightPanelOpen, rightPanelView } = project.ui;
    const gitTab =
      state.projectGitPanelTabByProject[projectId] ?? DEFAULT_GIT_PANEL_TAB;
    const showing =
      rightPanelOpen &&
      rightPanelView === view &&
      (view !== "git" || !options.gitTab || options.gitTab === gitTab);
    if (options.toggle && showing) {
      closeRightPanel(projectId);
      return;
    }

    if (options.gitTab) {
      state.setProjectGitPanelTab(projectId, options.gitTab);
    }
    if (rightPanelView === "terminal" && view !== "terminal") {
      state.discardUntouchedTerminals(projectId);
    }
    setRightPanel(projectId, { rightPanelOpen: true, rightPanelView: view });
    if (view === "terminal") {
      void state.openProjectTerminal(projectId);
    }
  };

  return {
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
          projects: updateProjectUiInList(
            state.projects,
            projectId,
            (item) => ({
              ...item.ui,
              panelSizes,
            }),
          ),
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
          projects: updateProjectUiInList(
            state.projects,
            projectId,
            (item) => ({
              ...item.ui,
              panelSizes,
            }),
          ),
        };
      });
    },

    setProjectChatHistoryPanelOpen: (projectId, open) => {
      set((state) => ({
        projects: updateProjectUiInList(
          state.projects,
          projectId,
          (project) => ({
            ...project.ui,
            chatHistoryPanelOpen: open,
          }),
        ),
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

    showRightPanelView,

    closeRightPanel,

    toggleRightPanel: (projectId) => {
      const project = get().projects.find((item) => item.id === projectId);
      if (!project) return;
      if (project.ui.rightPanelOpen) {
        closeRightPanel(projectId);
      } else {
        showRightPanelView(projectId, project.ui.rightPanelView);
      }
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
      showRightPanelView(project.id, "explorer");
      return true;
    },

    openProjectFileSearch: (projectId) => {
      if (!get().projects.some((project) => project.id === projectId)) {
        return;
      }
      set((state) => ({
        projectFileSearchRequests: {
          ...state.projectFileSearchRequests,
          [projectId]: (state.projectFileSearchRequests[projectId] ?? 0) + 1,
        },
      }));
      showRightPanelView(projectId, "explorer");
    },

    setOutputPanelOpen: (open) => set({ outputPanelOpen: open }),
  };
};
