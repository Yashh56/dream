import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  FolderX,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  History,
  UploadCloud,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useProjectGitStatus } from "@/hooks/use-project-git-status";
import { apiClient, getApiErrorMessage } from "@/lib/api-client";
import { getDefaultGitGenerationModelSelection } from "@/lib/ide-defaults";
import type { ProjectConfig, ProjectWorktreeInfo } from "@/types/ide";
import { getPullRequestBranchError } from "../git-actions/branch-utils";
import { CreatePrDialog } from "../git-actions/create-pr-dialog";
import { getStatusFileCount, hasPushableCommits } from "../git-actions/utils";
import {
  WorktreeActionDialog,
  type WorktreeDialogAction,
} from "../git-actions/worktree-action-dialog";
import { useIdeStore } from "../ide-store";
import { usePullRequestContext } from "../pull-requests/api";
import { SourceControlIcon } from "../source-control-icon";
import { useShowGitPanel } from "./show-git-panel";

type WorktreeProject = ProjectConfig & { worktree: ProjectWorktreeInfo };

/** How far the branch is from its upstream, when it is anywhere but level. */
const UpstreamSync = ({
  aheadCount,
  behindCount,
}: {
  aheadCount: number;
  behindCount: number;
}) => {
  const worktreeT = useTranslations("worktrees");
  if (aheadCount === 0 && behindCount === 0) {
    return null;
  }

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 font-mono text-muted-foreground text-xs tabular-nums"
      title={worktreeT("commitsAheadBehind", {
        ahead: aheadCount,
        behind: behindCount,
      })}
    >
      {aheadCount > 0 ? (
        <span className="inline-flex items-center gap-0.5">
          <ArrowUp className="size-3" />
          {aheadCount}
        </span>
      ) : null}
      {behindCount > 0 ? (
        <span className="inline-flex items-center gap-0.5">
          <ArrowDown className="size-3" />
          {behindCount}
        </span>
      ) : null}
    </span>
  );
};

/**
 * The chat footer's git controls: how far the branch is from its upstream
 * and a git menu (commit, push, sync, pull requests, finish a worktree).
 */
const GitFooterActionsImpl = ({
  active,
  project,
}: {
  /** Whether the project's workspace is on screen. */
  active: boolean;
  project: ProjectConfig;
}) => {
  const gitT = useTranslations("git");
  const worktreeT = useTranslations("worktrees");
  const projectId = project.id;
  const projectPath = project.path;
  const worktreeProject = project.worktree
    ? (project as WorktreeProject)
    : null;
  // Full detail: the upstream and ahead/behind counts are only in a full read.
  const { status } = useProjectGitStatus(projectPath, {
    active,
    detail: "full",
    hostId: project.hostId,
  });
  const { data: pullRequestContext } = usePullRequestContext(
    projectPath,
    active && Boolean(status?.isRepo),
  );
  const gitRefreshKey = useIdeStore(
    (s) => s.projectGitRefreshKeys[projectId] ?? 0,
  );
  // The git write running for this project, from any surface.
  const gitWrite = useIdeStore((s) => s.gitWriteByProject[projectId] ?? null);
  const openExternalUrl = useIdeStore((s) => s.openExternalUrl);
  const settings = useIdeStore((s) => s.settings);
  const modelSelection = useMemo(
    () => getDefaultGitGenerationModelSelection(settings),
    [settings],
  );
  const showGitPanel = useShowGitPanel(projectId);
  const [openingRepository, setOpeningRepository] = useState(false);
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
  // Kept after close, so a closing dialog does not switch modes mid-animation.
  const [worktreeAction, setWorktreeAction] =
    useState<WorktreeDialogAction>("merge");

  const pullRequest = pullRequestContext
    ? pullRequestContext.current
    : undefined;
  const hasChanges = getStatusFileCount(status) > 0;
  const canPush = hasPushableCommits(status);
  const gitBusy = gitWrite !== null;
  const syncing = gitWrite === "fetch" || gitWrite === "pull" ? gitWrite : null;
  const canCreatePr =
    Boolean(status?.remoteName) &&
    pullRequest?.state !== "open" &&
    !getPullRequestBranchError(
      status?.branch ?? null,
      status?.baseBranch ?? "main",
      { detachedHead: "detached", sameBranch: () => "same" },
    );
  const worktreeMergeBase =
    worktreeProject?.worktree.baseRef ?? status?.baseBranch ?? null;

  const handlePush = useCallback(async () => {
    if (gitBusy || !canPush) {
      return;
    }

    const outcome = await useIdeStore.getState().pushProject(projectId);
    if (outcome.ok) {
      toast.success(
        gitT("pushedTo", {
          target: outcome.result.upstreamBranch ?? outcome.result.branch,
        }),
      );
    } else {
      toast.error(getApiErrorMessage(outcome.error, gitT("unableToPush")));
    }
  }, [canPush, gitBusy, gitT, projectId]);

  const handleSync = async (action: "fetch" | "pull") => {
    if (gitBusy) return;
    const store = useIdeStore.getState();
    if (action === "fetch") {
      const outcome = await store.fetchProject(projectId);
      if (outcome.ok) {
        toast.success(gitT("fetchedFrom", { target: outcome.result.remote }));
      } else {
        toast.error(getApiErrorMessage(outcome.error, gitT("unableToFetch")));
      }
      return;
    }
    const outcome = await store.pullProject(projectId);
    if (outcome.ok) {
      const { commitCount, upstreamBranch } = outcome.result;
      toast.success(
        commitCount > 0
          ? gitT("pulledFrom", { count: commitCount, target: upstreamBranch })
          : gitT("alreadyUpToDate", { target: upstreamBranch }),
      );
    } else {
      toast.error(getApiErrorMessage(outcome.error, gitT("unableToPull")));
    }
  };

  const handleOpenRepository = async () => {
    if (openingRepository) return;
    setOpeningRepository(true);
    try {
      const { url } = await apiClient.gitRemoteUrl({ projectPath });
      openExternalUrl(url);
    } catch (error) {
      toast.error(getApiErrorMessage(error, gitT("unableToOpenRepository")));
    } finally {
      setOpeningRepository(false);
    }
  };

  const openWorktreeDialog = useCallback((action: WorktreeDialogAction) => {
    setWorktreeAction(action);
    setWorktreeDialogOpen(true);
  }, []);

  const handlePrCompleted = useCallback(
    (url: string | null, shouldOpen: boolean) => {
      if (url && shouldOpen) {
        openExternalUrl(url);
      }
    },
    [openExternalUrl],
  );

  if (!status?.isRepo) {
    return null;
  }

  const menu = (
    <DropdownMenuContent align="end" className="w-56" side="top">
      <DropdownMenuItem
        disabled={!hasChanges || gitBusy}
        onClick={() => showGitPanel("changes", { focusCommitMessage: true })}
      >
        <GitCommitHorizontal className="size-4" />
        {gitT("commit")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canPush || gitBusy}
        onClick={() => {
          void handlePush();
        }}
      >
        <UploadCloud className="size-4" />
        {status.upstreamBranch ? gitT("push") : gitT("publishBranch")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!status.remoteName || gitBusy}
        onClick={() => void handleSync("fetch")}
      >
        {syncing === "fetch" ? (
          <Spinner className="size-4" />
        ) : (
          <Download className="size-4" />
        )}
        {gitT("fetch")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!status.upstreamBranch || gitBusy}
        onClick={() => void handleSync("pull")}
      >
        {syncing === "pull" ? (
          <Spinner className="size-4" />
        ) : (
          <ArrowDown className="size-4" />
        )}
        {gitT("pull")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {pullRequest ? (
        <DropdownMenuItem onClick={() => showGitPanel("pull-request")}>
          <GitPullRequest className="size-4" />
          {gitT("viewPullRequest", { number: pullRequest.number })}
        </DropdownMenuItem>
      ) : null}
      {pullRequest?.state === "open" ? null : (
        <DropdownMenuItem
          disabled={!canCreatePr || gitBusy}
          onClick={() => setCreatePrOpen(true)}
        >
          <GitPullRequest className="size-4" />
          {gitT("createPullRequest")}
        </DropdownMenuItem>
      )}
      {worktreeProject ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={gitBusy}
            onClick={() => openWorktreeDialog("merge")}
          >
            <GitMerge className="size-4" />
            {worktreeMergeBase
              ? worktreeT("mergeInto", { base: worktreeMergeBase })
              : worktreeT("merge")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={gitBusy}
            onClick={() => openWorktreeDialog("remove")}
            variant="destructive"
          >
            <FolderX className="size-4" />
            {worktreeT("removeWorktree")}
          </DropdownMenuItem>
        </>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => showGitPanel("log")}>
        <History className="size-4" />
        {gitT("viewHistory")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!status.remoteName || openingRepository}
        onClick={() => void handleOpenRepository()}
      >
        {openingRepository ? (
          <Spinner className="size-4" />
        ) : (
          <ExternalLink className="size-4" />
        )}
        {gitT("openRepository")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <>
      <UpstreamSync
        aheadCount={status.upstreamBranch ? status.aheadCount : 0}
        behindCount={status.upstreamBranch ? status.behindCount : 0}
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={gitT("gitActions")}
              className="text-muted-foreground"
              size="icon-sm"
              title={gitT("gitActions")}
              variant="ghost"
            />
          }
        >
          {gitBusy ? (
            <Spinner className="size-3.5" />
          ) : (
            <SourceControlIcon className="size-3.5" />
          )}
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>

      {createPrOpen ? (
        <CreatePrDialog
          branch={status.branch}
          onCompleted={handlePrCompleted}
          onOpenChange={setCreatePrOpen}
          open
          model={modelSelection.model}
          modelSpeed={modelSelection.modelSpeed}
          projectId={projectId}
          projectPath={projectPath}
          provider={modelSelection.provider}
          reasoningEffort={modelSelection.reasoningEffort}
          refreshToken={gitRefreshKey}
          status={status}
        />
      ) : null}
      {worktreeProject ? (
        <WorktreeActionDialog
          action={worktreeAction}
          onOpenChange={setWorktreeDialogOpen}
          open={worktreeDialogOpen}
          project={worktreeProject}
        />
      ) : null}
    </>
  );
};

export const GitFooterActions = memo(GitFooterActionsImpl);
GitFooterActions.displayName = "GitFooterActions";
