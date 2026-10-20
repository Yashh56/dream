/**
 * The workspace's one row of controls on a phone-sized window: the chat
 * history and a new chat on the left; the project's panels (Git, files,
 * terminal, stash) on the right, each opening as a full sheet over the
 * chat. The browser is the desktop window's and is not offered here.
 */
import {
  Files,
  History,
  Inbox,
  MessageSquarePlus,
  TerminalSquare,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import type { RightPanelView } from "@/types/ide";
import { GitNavButton } from "../git-panel/nav-button";
import { WorkspaceNavButton } from "./nav-button";

export interface WorkspaceCompactBarProps {
  active: boolean;
  historyHasUnseenChats: boolean;
  historyOpen: boolean;
  onAddChat: () => void;
  onOpenTerminal: () => void;
  onSelectRightPanelView: (view: RightPanelView) => void;
  onToggleHistory: () => void;
  projectId: string;
  projectPath: string;
  rightPanelView: RightPanelView;
  rightVisible: boolean;
  stashAvailable: boolean;
  terminalHiddenWithActiveSession: boolean;
}

const WorkspaceCompactBarImpl = ({
  active,
  historyHasUnseenChats,
  historyOpen,
  onAddChat,
  onOpenTerminal,
  onSelectRightPanelView,
  onToggleHistory,
  projectId,
  projectPath,
  rightPanelView,
  rightVisible,
  stashAvailable,
  terminalHiddenWithActiveSession,
}: WorkspaceCompactBarProps) => {
  const t = useTranslations("workspace");
  const commonT = useTranslations("common");
  const panelOpen = (view: RightPanelView) =>
    rightVisible && rightPanelView === view;

  return (
    <nav className="flex h-11 shrink-0 items-center gap-1 px-2">
      <WorkspaceNavButton
        aria-label={t("chatHistory")}
        active={historyOpen}
        accent={historyHasUnseenChats}
        onClick={onToggleHistory}
        title={t("chatHistory")}
      >
        <History className="size-4" />
      </WorkspaceNavButton>
      <WorkspaceNavButton
        aria-label={t("newChat")}
        onClick={onAddChat}
        title={t("newChat")}
      >
        <MessageSquarePlus className="size-4" />
      </WorkspaceNavButton>
      <div className="ml-auto flex items-center gap-1">
        <GitNavButton
          active={panelOpen("git")}
          onClick={() => onSelectRightPanelView("git")}
          projectId={projectId}
          projectPath={projectPath}
          visible={active}
        />
        <WorkspaceNavButton
          aria-label={commonT("files")}
          active={panelOpen("explorer")}
          onClick={() => onSelectRightPanelView("explorer")}
          title={commonT("files")}
        >
          <Files className="size-4" />
        </WorkspaceNavButton>
        <WorkspaceNavButton
          aria-label={commonT("terminal")}
          active={panelOpen("terminal")}
          accent={terminalHiddenWithActiveSession}
          onClick={onOpenTerminal}
          title={commonT("terminal")}
        >
          <TerminalSquare className="size-4" />
        </WorkspaceNavButton>
        {stashAvailable ? (
          <WorkspaceNavButton
            aria-label={commonT("stash")}
            active={panelOpen("stash")}
            accent
            onClick={() => onSelectRightPanelView("stash")}
            title={commonT("stash")}
          >
            <Inbox className="size-4" />
          </WorkspaceNavButton>
        ) : null}
      </div>
    </nav>
  );
};

export const WorkspaceCompactBar = memo(WorkspaceCompactBarImpl);
WorkspaceCompactBar.displayName = "WorkspaceCompactBar";
