import { Code, Files, Globe, Inbox, TerminalSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import type { GitPanelTab, RightPanelView } from "@/types/ide";
import { GitNavButton } from "../git-panel/nav-button";
import { useShortcutTitle } from "../shortcuts/shortcut-keys";
import { WorkspaceNavButton } from "./nav-button";

export interface WorkspaceRightRailProps {
  active: boolean;
  browserHiddenWithActiveTab: boolean;
  changesAvailable: boolean;
  gitPanelTab: GitPanelTab;
  onOpenTerminal: () => void;
  onSelectRightPanelView: (view: RightPanelView) => void;
  /** Shows the Git panel's changes tab, or closes the panel on it. */
  onShowChanges: () => void;
  /** Shows the Git panel off its changes tab, or closes the panel. */
  onShowGit: () => void;
  projectId: string;
  projectPath: string;
  rightPanelView: RightPanelView;
  rightVisible: boolean;
  stashAvailable: boolean;
  terminalHiddenWithActiveSession: boolean;
}

const WorkspaceRightRailImpl = ({
  active,
  browserHiddenWithActiveTab,
  changesAvailable,
  gitPanelTab,
  onOpenTerminal,
  onSelectRightPanelView,
  onShowChanges,
  onShowGit,
  projectId,
  projectPath,
  rightPanelView,
  rightVisible,
  stashAvailable,
  terminalHiddenWithActiveSession,
}: WorkspaceRightRailProps) => {
  const t = useTranslations("common");
  const changesTitle = useShortcutTitle("showChanges", t("changes"));
  const filesTitle = useShortcutTitle("showFiles", t("files"));
  const browserTitle = useShortcutTitle("showBrowser", t("browser"));
  const terminalTitle = useShortcutTitle("toggleTerminal", t("terminal"));
  const stashTitle = useShortcutTitle("showStash", t("stash"));
  // Changes is a tab of the Git panel with its own button here; the Git
  // button stands for the panel's other tabs.
  const gitVisible = rightVisible && rightPanelView === "git";
  const changesVisible = gitVisible && gitPanelTab === "changes";

  return (
    <aside className="relative z-20 flex w-12 shrink-0 flex-col items-center gap-1 py-2">
      <WorkspaceNavButton
        active={changesVisible}
        accent={changesAvailable}
        onClick={onShowChanges}
        title={changesTitle}
      >
        <Code className="size-4" />
      </WorkspaceNavButton>
      <WorkspaceNavButton
        active={rightVisible && rightPanelView === "explorer"}
        onClick={() => onSelectRightPanelView("explorer")}
        title={filesTitle}
      >
        <Files className="size-4" />
      </WorkspaceNavButton>
      <WorkspaceNavButton
        active={rightVisible && rightPanelView === "browser"}
        accent={browserHiddenWithActiveTab}
        onClick={() => onSelectRightPanelView("browser")}
        title={browserTitle}
      >
        <Globe className="size-4" />
      </WorkspaceNavButton>
      <WorkspaceNavButton
        aria-label={t("terminal")}
        active={rightVisible && rightPanelView === "terminal"}
        accent={terminalHiddenWithActiveSession}
        onClick={onOpenTerminal}
        title={terminalTitle}
      >
        <TerminalSquare className="size-4" />
      </WorkspaceNavButton>
      <GitNavButton
        active={gitVisible && !changesVisible}
        onClick={onShowGit}
        projectId={projectId}
        projectPath={projectPath}
        visible={active}
      />
      <WorkspaceNavButton
        active={rightVisible && rightPanelView === "stash"}
        accent={stashAvailable}
        className="mt-auto"
        onClick={() => onSelectRightPanelView("stash")}
        title={stashTitle}
      >
        <Inbox className="size-4" />
      </WorkspaceNavButton>
    </aside>
  );
};

export const WorkspaceRightRail = memo(WorkspaceRightRailImpl);
WorkspaceRightRail.displayName = "WorkspaceRightRail";
