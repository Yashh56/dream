import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FolderX,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  History,
  type LucideIcon,
  UploadCloud,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
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
import { type GitNextStep, getGitNextStep } from "../git-actions/next-step";
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

const STEP_ICONS: Record<GitNextStep["kind"], LucideIcon> = {
  commit: GitCommitHorizontal,
  "create-pr": GitPullRequest,
  "merge-worktree": GitMerge,
  publish: UploadCloud,
  push: UploadCloud,
  "remove-worktree": FolderX,
  "view-pr": GitPullRequest,
};

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
 * The chat footer's git controls: how far the branch is from its upstream,
 * the one action that moves it along next (commit, push, open or follow a
 * pull request, finish a worktree) and a menu with the rest.
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
  const bumpProjectGitRefreshKey = useIdeStore(
    (s) => s.bumpProjectGitRefreshKey,
  );
  const openExternalUrl = useIdeStore((s) => s.openExternalUrl);
  const settings = useIdeStore((s) => s.settings);
  const modelSelection = useMemo(
    () => getDefaultGitGenerationModelSelection(settings),
    [settings],
  );
  const showGitPanel = useShowGitPanel(projectId);
  const [pushing, setPushing] = useState(false);
  const [createPrOpen, setCreatePrOpen] = useState(false);
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
  // Kept after close, so a closing dialog does not switch modes mid-animation.
  const [worktreeAction, setWorktreeAction] =
    useState<WorktreeDialogAction>("merge");

  const pullRequest = pullRequestContext
    ? pullRequestContext.current
    : undefined;
  const worktreeBaseBranch = worktreeProject
    ? (worktreeProject.worktree.baseRef ?? null)
    : undefined;
  const nextStep = getGitNextStep({ pullRequest, status, worktreeBaseBranch });

  const hasChanges = getStatusFileCount(status) > 0;
  const canPush = hasPushableCommits(status);
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
    if (pushing || !canPush) {
      return;
    }

    setPushing(true);
    try {
      const result = await apiClient.gitPush({
        commitMessage: null,
        includeUnstaged: true,
        nextStep: "push",
        projectPath,
      });
      toast.success(
        gitT("pushedTo", { target: result.upstreamBranch ?? result.branch }),
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, gitT("unableToPush")));
    } finally {
      setPushing(false);
      bumpProjectGitRefreshKey(projectId);
    }
  }, [
    bumpProjectGitRefreshKey,
    canPush,
    gitT,
    projectId,
    projectPath,
    pushing,
  ]);

  const openWorktreeDialog = useCallback((action: WorktreeDialogAction) => {
    setWorktreeAction(action);
    setWorktreeDialogOpen(true);
  }, []);

  const handleNextStep = useCallback(() => {
    switch (nextStep?.kind) {
      case "commit":
        showGitPanel("changes", { focusCommitMessage: true });
        return;
      case "publish":
      case "push":
        void handlePush();
        return;
      case "create-pr":
        setCreatePrOpen(true);
        return;
      case "view-pr":
        showGitPanel("pull-request");
        return;
      case "merge-worktree":
        openWorktreeDialog("merge");
        return;
      case "remove-worktree":
        openWorktreeDialog("remove");
        return;
      default:
        return;
    }
  }, [handlePush, nextStep?.kind, openWorktreeDialog, showGitPanel]);

  const handlePrCompleted = useCallback(
    (url: string | null, shouldOpen: boolean) => {
      bumpProjectGitRefreshKey(projectId);
      if (url && shouldOpen) {
        openExternalUrl(url);
      }
    },
    [bumpProjectGitRefreshKey, openExternalUrl, projectId],
  );

  if (!status?.isRepo) {
    return null;
  }

  const getStepLabel = (step: GitNextStep) => {
    switch (step.kind) {
      case "commit":
        return gitT("commitFiles", { count: step.fileCount });
      case "publish":
        return gitT("publishBranch");
      case "push":
        return gitT("push");
      case "create-pr":
        return gitT("createPr");
      case "view-pr":
        return gitT("viewPullRequest", { number: step.pullRequest.number });
      case "merge-worktree":
        return step.baseBranch
          ? worktreeT("mergeInto", { base: step.baseBranch })
          : worktreeT("merge");
      case "remove-worktree":
        return worktreeT("removeWorktree");
    }
  };

  const StepIcon = nextStep ? STEP_ICONS[nextStep.kind] : null;
  const stepBusy =
    pushing && (nextStep?.kind === "push" || nextStep?.kind === "publish");

  const menu = (
    <DropdownMenuContent align="end" className="w-56" side="top">
      <DropdownMenuItem
        disabled={!hasChanges}
        onClick={() => showGitPanel("changes", { focusCommitMessage: true })}
      >
        <GitCommitHorizontal className="size-4" />
        {gitT("commit")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canPush || pushing}
        onClick={() => {
          void handlePush();
        }}
      >
        <UploadCloud className="size-4" />
        {status.upstreamBranch ? gitT("push") : gitT("publishBranch")}
      </DropdownMenuItem>
      {pullRequest ? (
        <DropdownMenuItem onClick={() => showGitPanel("pull-request")}>
          <GitPullRequest className="size-4" />
          {gitT("viewPullRequest", { number: pullRequest.number })}
        </DropdownMenuItem>
      ) : null}
      {pullRequest?.state === "open" ? null : (
        <DropdownMenuItem
          disabled={!canCreatePr}
          onClick={() => setCreatePrOpen(true)}
        >
          <GitPullRequest className="size-4" />
          {gitT("createPullRequest")}
        </DropdownMenuItem>
      )}
      {worktreeProject ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openWorktreeDialog("merge")}>
            <GitMerge className="size-4" />
            {worktreeMergeBase
              ? worktreeT("mergeInto", { base: worktreeMergeBase })
              : worktreeT("merge")}
          </DropdownMenuItem>
          <DropdownMenuItem
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
    </DropdownMenuContent>
  );

  return (
    <>
      <UpstreamSync
        aheadCount={status.upstreamBranch ? status.aheadCount : 0}
        behindCount={status.upstreamBranch ? status.behindCount : 0}
      />

      {nextStep && StepIcon ? (
        <ButtonGroup className="min-w-0 shrink">
          <Button
            className="min-w-0"
            disabled={stepBusy}
            onClick={handleNextStep}
            size="sm"
            variant="outline"
          >
            {stepBusy ? (
              <Spinner className="size-3.5" />
            ) : (
              <StepIcon className="size-3.5" />
            )}
            <span className="truncate">{getStepLabel(nextStep)}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={gitT("gitActions")}
                  size="icon-sm"
                  title={gitT("gitActions")}
                  variant="outline"
                />
              }
            >
              <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            {menu}
          </DropdownMenu>
        </ButtonGroup>
      ) : (
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
            {pushing ? (
              <Spinner className="size-3.5" />
            ) : (
              <SourceControlIcon className="size-3.5" />
            )}
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      )}

      {createPrOpen ? (
        <CreatePrDialog
          branch={status.branch}
          onCompleted={handlePrCompleted}
          onOpenChange={setCreatePrOpen}
          open
          model={modelSelection.model}
          modelSpeed={modelSelection.modelSpeed}
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
