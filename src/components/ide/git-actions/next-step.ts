import type { ProjectGitStatusResponse } from "@/types/ide";
import type { PullRequestSummary } from "../pull-requests/api";
import { getPullRequestBranchError } from "./branch-utils";
import { getStatusFileCount } from "./utils";

/**
 * The one git action that moves the current branch along, in the order work
 * flows: commit, publish or push, open a pull request, follow it, then merge
 * or remove a worktree.
 */
export type GitNextStep =
  | { kind: "commit"; fileCount: number }
  | { kind: "publish" }
  | { kind: "push"; aheadCount: number }
  | { kind: "create-pr" }
  | { kind: "view-pr"; pullRequest: PullRequestSummary }
  | { kind: "merge-worktree"; baseBranch: string | null }
  | { kind: "remove-worktree" };

export const getGitNextStep = ({
  pullRequest,
  status,
  worktreeBaseBranch,
}: {
  /**
   * The branch's pull request: `null` when it has none, `undefined` when
   * that is not known (not read yet, or GitHub unreachable). Unknown hides
   * the pull request steps rather than offering one that may exist.
   */
  pullRequest: PullRequestSummary | null | undefined;
  /** A full status read: the upstream and ahead count are only in one. */
  status: ProjectGitStatusResponse | null;
  /** Set for a worktree project: the branch it merges into, if known. */
  worktreeBaseBranch?: string | null;
}): GitNextStep | null => {
  if (!status?.isRepo) {
    return null;
  }

  const fileCount = getStatusFileCount(status);
  if (fileCount > 0) {
    return { kind: "commit", fileCount };
  }

  if (status.upstreamBranch) {
    if (status.aheadCount > 0) {
      return { kind: "push", aheadCount: status.aheadCount };
    }
  } else if (status.remoteName) {
    return { kind: "publish" };
  }

  const isWorktree = worktreeBaseBranch !== undefined;

  if (pullRequest?.state === "open") {
    return { kind: "view-pr", pullRequest };
  }

  if (isWorktree && pullRequest?.state === "merged") {
    return { kind: "remove-worktree" };
  }

  if (isWorktree && !status.remoteName) {
    return {
      kind: "merge-worktree",
      baseBranch: worktreeBaseBranch ?? status.baseBranch,
    };
  }

  const canOpenPullRequest =
    pullRequest !== undefined &&
    pullRequest?.state !== "merged" &&
    Boolean(status.remoteName) &&
    !getPullRequestBranchError(status.branch, status.baseBranch ?? "main", {
      detachedHead: "detached",
      sameBranch: () => "same",
    });

  return canOpenPullRequest ? { kind: "create-pr" } : null;
};
