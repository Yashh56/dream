import { terminalClient } from "@/lib/terminal-client";
import type { ProjectConfig, ProjectWorktreeInfo } from "@/types/ide";
import { deleteTerminalScrollback } from "../terminal-scrollback";
import type { IdeState, IdeStoreGet, IdeStoreSet } from "./ide-store-types";
import {
  commitWorkspaceRemoval,
  dropProjectRuntimeState,
} from "./project-runtime-state";
import * as workspace from "./workspace-document";

export const createProjectLifecycleActions = (
  set: IdeStoreSet,
  get: IdeStoreGet,
): Pick<
  IdeState,
  | "setProjects"
  | "setActiveProjectId"
  | "addProject"
  | "closeProject"
  | "forgetClosedProject"
  | "stopProjectTerminals"
  | "updateProject"
> => ({
  setProjects: (projects: ProjectConfig[]) => {
    set((state) => workspace.setProjects(state, state.settings, projects));
  },

  setActiveProjectId: (id: string | null) => {
    set((state) => {
      const next = workspace.activateProject(state, id);
      // Chats that finished while the user was elsewhere lose their mark
      // once their project is in front.
      const completedChatIds = { ...state.completedChatIds };
      let marksCleared = false;
      if (next.activeProjectId) {
        for (const chat of state.chats) {
          if (
            chat.projectId === next.activeProjectId &&
            completedChatIds[chat.id]
          ) {
            delete completedChatIds[chat.id];
            marksCleared = true;
          }
        }
      }
      if (next.activeProjectId === state.activeProjectId && !marksCleared) {
        return state;
      }
      return marksCleared ? { ...next, completedChatIds } : next;
    });
  },

  addProject: (
    path: string,
    options?: {
      activate?: boolean;
      hostId?: string;
      worktree?: ProjectWorktreeInfo;
    },
  ) => {
    set(
      (state) =>
        workspace.openProject(state, state.settings, path, {
          activate: options?.activate,
          hostId: options?.hostId,
          worktree: options?.worktree,
        }).doc,
    );
  },

  stopProjectTerminals: async (projectId: string) => {
    const terminalSessionIds =
      get().projectTerminalSessionIds?.[projectId] ?? [];
    const stops = terminalSessionIds.map(async (sessionId) => {
      deleteTerminalScrollback(sessionId);
      try {
        await terminalClient.stop(sessionId);
      } catch (error) {
        // The host may be gone; nothing here can stop the shell then.
        console.warn(`Unable to stop terminal ${sessionId}.`, error);
      }
    });
    await Promise.all(stops);
  },

  closeProject: (projectId: string) => {
    void get().stopProjectTerminals(projectId);
    set((state) => {
      const runtime = dropProjectRuntimeState(state, projectId);
      return {
        ...runtime,
        ...workspace.closeProject(
          { ...state, ...runtime },
          state.settings,
          projectId,
        ),
      };
    });
  },

  forgetClosedProject: (projectId: string) => {
    if (!get().closedProjects.some((project) => project.id === projectId)) {
      return;
    }
    const state = get();
    void commitWorkspaceRemoval(
      set,
      get,
      workspace.removeProjects(state, state.settings, [projectId]),
    );
    // Its host's catalog hears of the removal with the next save.
    get().persist();
  },

  updateProject: (
    projectId: string,
    updater: (project: ProjectConfig) => ProjectConfig,
  ) => {
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? updater(project) : project,
      ),
    }));
  },
});
