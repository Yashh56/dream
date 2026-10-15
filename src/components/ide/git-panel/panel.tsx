import { RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { GitPanelTab, ProjectConfig } from "@/types/ide";
import { useIdeStore } from "../ide-store";
import { RightPanelHeaderIconButton } from "../right-panel-header-icon-button";
import { SourceControlIcon } from "../source-control-icon";
import { GitPanelHeaderSlotContext } from "./header-actions";
import { GitLog } from "./log";
import { GitOverview } from "./overview";

// The pull request view brings Markdown and diff rendering; it loads the
// first time its tab is shown.
const PullRequestView = lazy(() =>
  import("../pull-requests/panel").then((module) => ({
    default: module.PullRequestView,
  })),
);

const GIT_PANEL_TABS: readonly GitPanelTab[] = [
  "overview",
  "log",
  "pull-request",
];

const isGitPanelTab = (value: unknown): value is GitPanelTab =>
  GIT_PANEL_TABS.includes(value as GitPanelTab);

const TabLoadingFallback = () => (
  <div className="flex h-full items-center justify-center">
    <Spinner className="size-4 text-muted-foreground" />
  </div>
);

/**
 * The Git right-panel view: the current branch's overview, its log and its
 * pull request, as tabs under one header. A tab mounts the first time it is
 * shown and stays mounted, so the log keeps its loaded pages and search.
 */
export const GitPanel = ({
  active,
  onClosePanel,
  project,
}: {
  active: boolean;
  onClosePanel: () => void;
  project: ProjectConfig;
}) => {
  const commonT = useTranslations("common");
  const gitT = useTranslations("git");
  const projectId = project.id;
  const tab = useIdeStore(
    (s) => s.projectGitPanelTabByProject[projectId] ?? "overview",
  );
  const setProjectGitPanelTab = useIdeStore((s) => s.setProjectGitPanelTab);
  const bumpProjectGitRefreshKey = useIdeStore(
    (s) => s.bumpProjectGitRefreshKey,
  );
  const setProjectRightPanelOpen = useIdeStore(
    (s) => s.setProjectRightPanelOpen,
  );
  const setProjectRightPanelView = useIdeStore(
    (s) => s.setProjectRightPanelView,
  );
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [visitedTabs, setVisitedTabs] = useState(
    () => new Set<GitPanelTab>([tab]),
  );

  useEffect(() => {
    setVisitedTabs((visited) =>
      visited.has(tab) ? visited : new Set([...visited, tab]),
    );
  }, [tab]);

  // Commits, pushes and branch switches made outside the app move nothing
  // here, so showing the panel reads git again.
  useEffect(() => {
    if (active) {
      bumpProjectGitRefreshKey(projectId);
    }
  }, [active, bumpProjectGitRefreshKey, projectId]);

  const handleTabChange = useCallback(
    (value: unknown) => {
      if (isGitPanelTab(value)) {
        setProjectGitPanelTab(projectId, value);
      }
    },
    [projectId, setProjectGitPanelTab],
  );

  const handleShowTab = useCallback(
    (value: GitPanelTab) => setProjectGitPanelTab(projectId, value),
    [projectId, setProjectGitPanelTab],
  );

  const handleOpenChanges = useCallback(() => {
    setProjectRightPanelView(projectId, "changes");
    setProjectRightPanelOpen(projectId, true);
  }, [projectId, setProjectRightPanelOpen, setProjectRightPanelView]);

  const handleRefresh = useCallback(() => {
    bumpProjectGitRefreshKey(projectId);
  }, [bumpProjectGitRefreshKey, projectId]);

  const renderTab = (value: GitPanelTab) => {
    const tabActive = active && tab === value;
    if (value === "overview") {
      return (
        <GitOverview
          active={tabActive}
          onOpenChanges={handleOpenChanges}
          onShowTab={handleShowTab}
          project={project}
        />
      );
    }
    if (value === "log") {
      return <GitLog active={tabActive} projectPath={project.path} />;
    }
    return (
      <Suspense fallback={<TabLoadingFallback />}>
        <PullRequestView active={tabActive} project={project} />
      </Suspense>
    );
  };

  return (
    <GitPanelHeaderSlotContext.Provider value={headerSlot}>
      <Tabs
        className="h-full min-h-0 gap-0"
        onValueChange={handleTabChange}
        value={tab}
      >
        <div className="flex min-h-[50px] shrink-0 items-center gap-2 border-b border-surface-200 bg-surface-50 px-3 py-2 dark:border-surface-800 dark:bg-surface-900">
          <RightPanelHeaderIconButton
            icon={SourceControlIcon}
            onClose={onClosePanel}
          />
          <TabsList aria-label={gitT("views")} className="min-w-0">
            <TabsTrigger value="overview">{gitT("overview")}</TabsTrigger>
            <TabsTrigger value="log">{gitT("log")}</TabsTrigger>
            <TabsTrigger value="pull-request">
              {gitT("pullRequest")}
            </TabsTrigger>
          </TabsList>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <div className="contents" ref={setHeaderSlot} />
            {tab === "pull-request" ? null : (
              <Button
                aria-label={commonT("refresh")}
                className="size-7 text-muted-foreground"
                onClick={handleRefresh}
                size="icon-sm"
                title={commonT("refresh")}
                variant="ghost"
              >
                <RotateCw className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {GIT_PANEL_TABS.map((value) =>
            visitedTabs.has(value) ? (
              <TabsContent
                className={cn(
                  // Text inherits, as in the other right-panel views.
                  "absolute inset-0 min-h-0 text-[length:inherit]",
                  tab !== value && "hidden",
                )}
                keepMounted
                key={value}
                value={value}
              >
                {renderTab(value)}
              </TabsContent>
            ) : null,
          )}
        </div>
      </Tabs>
    </GitPanelHeaderSlotContext.Provider>
  );
};
