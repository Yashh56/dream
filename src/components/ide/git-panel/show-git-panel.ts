import { useCallback, useEffect } from "react";
import type { GitPanelTab } from "@/types/ide";
import { useIdeStore } from "../ide-store";

/**
 * Projects whose commit message should take focus the next time their
 * Changes tab is shown. A request made from outside the panel (the chat
 * footer's Commit) is answered once the panel has mounted and is visible.
 */
const pendingCommitFocus = new Set<string>();
const commitFocusListeners = new Set<() => void>();

const requestCommitMessageFocus = (projectId: string) => {
  pendingCommitFocus.add(projectId);
  for (const listener of commitFocusListeners) {
    listener();
  }
};

/** Calls `focus` when a commit-message focus request for the project is open and the tab is shown. */
export const useCommitMessageFocusRequest = (
  projectId: string,
  active: boolean,
  focus: () => void,
) => {
  useEffect(() => {
    if (!active) {
      return;
    }

    const take = () => {
      if (pendingCommitFocus.delete(projectId)) {
        // After the panel's open transition has laid the textarea out.
        requestAnimationFrame(focus);
      }
    };
    take();
    commitFocusListeners.add(take);
    return () => {
      commitFocusListeners.delete(take);
    };
  }, [active, focus, projectId]);
};

/**
 * Shows a project's Git panel from anywhere in its workspace (the workspace
 * follows the project's persisted right-panel view): on `tab`, or the tab it
 * last showed, optionally focusing the commit message on Changes.
 */
export const useShowGitPanel = (projectId: string) =>
  useCallback(
    (tab?: GitPanelTab, options: { focusCommitMessage?: boolean } = {}) => {
      useIdeStore
        .getState()
        .showRightPanelView(projectId, "git", { gitTab: tab });
      if (options.focusCommitMessage && tab === "changes") {
        requestCommitMessageFocus(projectId);
      }
    },
    [projectId],
  );
