import {
  FolderX,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  UploadCloud,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getDefaultGitGenerationModelSelection } from "@/lib/ide-defaults";
import type {
  AiProvider,
  ModelSpeed,
  ProjectConfig,
  ProjectGitStatusResponse,
  ProjectWorktreeInfo,
  ReasoningEffort,
} from "@/types/ide";
import { getPullRequestBranchError } from "../git-actions/branch-utils";
import { CommitDialog } from "../git-actions/commit-dialog";
import { CreatePrDialog } from "../git-actions/create-pr-dialog";
import { PushDialog } from "../git-actions/push-dialog";
import { getStatusFileCount, hasPushableCommits } from "../git-actions/utils";
import {
  WorktreeActionDialog,
  type WorktreeDialogAction,
} from "../git-actions/worktree-action-dialog";
import { useIdeStore } from "../ide-store";

type GitActionDialog = "commit" | "push" | "pr" | WorktreeDialogAction | null;
type ActiveGitActionDialog = Exclude<
  GitActionDialog,
  WorktreeDialogAction | null
>;
type WorktreeProject = ProjectConfig & { worktree: ProjectWorktreeInfo };

const isWorktreeDialog = (
  dialog: GitActionDialog,
): dialog is WorktreeDialogAction => dialog === "merge" || dialog === "remove";

const GitActionDialogHost = ({
  action,
  branch,
  onActionCompleted,
  onOpenChange,
  onPrCompleted,
  model,
  modelSpeed,
  projectPath,
  provider,
  reasoningEffort,
  refreshToken,
  status,
}: {
  action: ActiveGitActionDialog;
  branch: string | null;
  onActionCompleted: () => void;
  onOpenChange: (open: boolean) => void;
  onPrCompleted: (url: string | null, shouldOpen: boolean) => void;
  model: string;
  modelSpeed: ModelSpeed;
  projectPath: string;
  provider: AiProvider;
  reasoningEffort: ReasoningEffort | null;
  refreshToken: number;
  status: ProjectGitStatusResponse | null;
}) => {
  if (action === "commit") {
    return (
      <CommitDialog
        branch={branch}
        onCompleted={onActionCompleted}
        onOpenChange={onOpenChange}
        open
        model={model}
        modelSpeed={modelSpeed}
        projectPath={projectPath}
        provider={provider}
        reasoningEffort={reasoningEffort}
        refreshToken={refreshToken}
        status={status}
      />
    );
  }

  if (action === "push") {
    return (
      <PushDialog
        branch={branch}
        onCompleted={onActionCompleted}
        onOpenChange={onOpenChange}
        open
        projectPath={projectPath}
        status={status}
      />
    );
  }

  return (
    <CreatePrDialog
      branch={branch}
      onCompleted={onPrCompleted}
      onOpenChange={onOpenChange}
      open
      model={model}
      modelSpeed={modelSpeed}
      projectPath={projectPath}
      provider={provider}
      reasoningEffort={reasoningEffort}
      refreshToken={refreshToken}
      status={status}
    />
  );
};

/**
 * The Git actions for the project's current branch: commit, push and
 * create a pull request, plus merge and remove for a worktree. Each opens
 * its dialog.
 */
export const GitActions = ({
  branch,
  projectId,
  projectPath,
  status,
}: {
  branch: string | null;
  projectId: string;
  projectPath: string;
  /** A full status read: push and pull requests need the remote details. */
  status: ProjectGitStatusResponse | null;
}) => {
  const gitT = useTranslations("git");
  const worktreeT = useTranslations("worktrees");
  const worktreeProject = useIdeStore((s) => {
    const project = s.projects.find((item) => item.id === projectId);
    return project?.worktree ? (project as WorktreeProject) : null;
  });
  const gitRefreshKey = useIdeStore(
    (s) => s.projectGitRefreshKeys[projectId] ?? 0,
  );
  const bumpProjectGitRefreshKey = useIdeStore(
    (s) => s.bumpProjectGitRefreshKey,
  );
  const openExternalUrl = useIdeStore((s) => s.openExternalUrl);
  const settings = useIdeStore((s) => s.settings);
  const gitGenerationModelSelection = useMemo(
    () => getDefaultGitGenerationModelSelection(settings),
    [settings],
  );
  const [activeDialog, setActiveDialog] = useState<GitActionDialog>(null);
  // Kept after close, so a closing dialog does not switch modes mid-animation.
  const [worktreeAction, setWorktreeAction] =
    useState<WorktreeDialogAction>("merge");
  const hasGitChanges = getStatusFileCount(status) > 0;
  const canPush = hasPushableCommits(status);
  const isPullRequestHeadBranch =
    Boolean(status?.remoteName) &&
    !getPullRequestBranchError(branch, status?.baseBranch ?? "main", {
      detachedHead: "detached",
      sameBranch: () => "same",
    });
  const canCreatePr = hasGitChanges || canPush || isPullRequestHeadBranch;
  // Same fallback the merge uses: the base recorded at creation, else the
  // repository's default base branch.
  const worktreeMergeBase =
    worktreeProject?.worktree.baseRef ?? status?.baseBranch ?? null;

  const handleOpenDialog = useCallback(
    (dialog: GitActionDialog) => {
      if (dialog === "push" && !canPush) {
        return;
      }

      if (dialog === "commit" && !hasGitChanges) {
        return;
      }

      if (dialog === "pr" && !canCreatePr) {
        return;
      }

      if (isWorktreeDialog(dialog)) {
        if (!worktreeProject) {
          return;
        }
        setWorktreeAction(dialog);
      }

      setActiveDialog(dialog);
    },
    [canCreatePr, canPush, hasGitChanges, worktreeProject],
  );

  const handleActionCompleted = useCallback(() => {
    bumpProjectGitRefreshKey(projectId);
  }, [bumpProjectGitRefreshKey, projectId]);

  const handlePrCompleted = useCallback(
    (url: string | null, shouldOpen: boolean) => {
      handleActionCompleted();
      if (url && shouldOpen) {
        openExternalUrl(url);
      }
    },
    [handleActionCompleted, openExternalUrl],
  );

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setActiveDialog(null);
    }
  }, []);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!hasGitChanges}
          onClick={() => handleOpenDialog("commit")}
          size="sm"
          variant="outline"
        >
          <GitCommitHorizontal className="size-4" />
          {gitT("commit")}
        </Button>
        <Button
          disabled={!canPush}
          onClick={() => handleOpenDialog("push")}
          size="sm"
          variant="outline"
        >
          <UploadCloud className="size-4" />
          {gitT("push")}
        </Button>
        <Button
          disabled={!canCreatePr}
          onClick={() => handleOpenDialog("pr")}
          size="sm"
          variant="outline"
        >
          <GitPullRequest className="size-4" />
          {gitT("createPullRequest")}
        </Button>
        {worktreeProject ? (
          <>
            <Button
              onClick={() => handleOpenDialog("merge")}
              size="sm"
              variant="outline"
            >
              <GitMerge className="size-4" />
              {worktreeMergeBase
                ? worktreeT("mergeInto", { base: worktreeMergeBase })
                : worktreeT("merge")}
            </Button>
            <Button
              onClick={() => handleOpenDialog("remove")}
              size="sm"
              variant="destructive"
            >
              <FolderX className="size-4" />
              {worktreeT("removeWorktree")}
            </Button>
          </>
        ) : null}
      </div>

      {activeDialog && !isWorktreeDialog(activeDialog) ? (
        <GitActionDialogHost
          action={activeDialog}
          branch={branch}
          onActionCompleted={handleActionCompleted}
          onOpenChange={handleDialogOpenChange}
          onPrCompleted={handlePrCompleted}
          model={gitGenerationModelSelection.model}
          modelSpeed={gitGenerationModelSelection.modelSpeed}
          projectPath={projectPath}
          provider={gitGenerationModelSelection.provider}
          reasoningEffort={gitGenerationModelSelection.reasoningEffort}
          refreshToken={gitRefreshKey}
          status={status}
        />
      ) : null}
      {worktreeProject ? (
        <WorktreeActionDialog
          action={worktreeAction}
          onOpenChange={handleDialogOpenChange}
          open={isWorktreeDialog(activeDialog)}
          project={worktreeProject}
        />
      ) : null}
    </>
  );
};
