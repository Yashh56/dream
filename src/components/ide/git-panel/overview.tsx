import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useProjectGitStatus } from "@/hooks/use-project-git-status";
import type {
  GitPanelTab,
  ProjectConfig,
  ProjectGitStatusResponse,
} from "@/types/ide";
import { GitDeltaSummary } from "../git-actions/summary";
import { getStatusFileCount } from "../git-actions/utils";
import { AppShellPlaceholder } from "../ide-helpers";
import { usePullRequestContext } from "../pull-requests/api";
import { PullRequestStatus } from "../pull-requests/status-badge";
import { GitActions } from "./actions";
import { GitLogRow, useCommitTimeFormatter, useGitLogFirstPage } from "./log";

const RECENT_COMMIT_COUNT = 5;

const Section = ({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) => (
  <section className="space-y-2">
    <div className="flex min-h-6 items-center justify-between gap-2">
      <h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const Placeholder = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground text-xs">{children}</p>
);

/** How far the branch is from its upstream: commits to push and to pull. */
const UpstreamSync = ({ status }: { status: ProjectGitStatusResponse }) => {
  const gitT = useTranslations("git");
  const worktreeT = useTranslations("worktrees");

  if (status.aheadCount === 0 && status.behindCount === 0) {
    return <span className="text-muted-foreground">{gitT("upToDate")}</span>;
  }

  return (
    <span
      className="inline-flex items-center gap-2 font-mono tabular-nums"
      title={worktreeT("commitsAheadBehind", {
        ahead: status.aheadCount,
        behind: status.behindCount,
      })}
    >
      <span className="inline-flex items-center gap-0.5">
        <ArrowUp className="size-3" />
        {status.aheadCount}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <ArrowDown className="size-3" />
        {status.behindCount}
      </span>
    </span>
  );
};

const BranchSection = ({
  project,
  status,
}: {
  project: ProjectConfig;
  status: ProjectGitStatusResponse;
}) => {
  const commonT = useTranslations("common");
  const gitT = useTranslations("git");
  const worktreeT = useTranslations("worktrees");
  const baseBranch = project.worktree?.baseRef ?? status.baseBranch;

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-xs">
      <dt className="text-muted-foreground">{commonT("branch")}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span
          className="min-w-0 truncate font-medium"
          title={status.branch ?? undefined}
        >
          {status.branch}
        </span>
        {project.worktree ? (
          <Badge className="shrink-0" variant="outline">
            {gitT("worktree")}
          </Badge>
        ) : null}
      </dd>
      <dt className="text-muted-foreground">{gitT("upstream")}</dt>
      <dd className="flex min-w-0 items-center gap-3">
        {status.upstreamBranch ? (
          <>
            <span className="truncate" title={status.upstreamBranch}>
              {status.upstreamBranch}
            </span>
            <UpstreamSync status={status} />
          </>
        ) : (
          <span className="text-muted-foreground">{gitT("notPublished")}</span>
        )}
      </dd>
      {baseBranch ? (
        <>
          <dt className="text-muted-foreground">{worktreeT("baseBranch")}</dt>
          <dd className="truncate" title={baseBranch}>
            {baseBranch}
          </dd>
        </>
      ) : null}
    </dl>
  );
};

const ChangesSection = ({
  onOpenChanges,
  status,
}: {
  onOpenChanges: () => void;
  status: ProjectGitStatusResponse;
}) => {
  const commonT = useTranslations("common");
  const gitT = useTranslations("git");
  const panelsT = useTranslations("panels");
  const hasChanges = getStatusFileCount(status) > 0;

  return (
    <Section
      action={
        hasChanges ? (
          <Button
            className="-mr-2"
            onClick={onOpenChanges}
            size="xs"
            variant="ghost"
          >
            {commonT("open")}
          </Button>
        ) : null
      }
      title={commonT("changes")}
    >
      {hasChanges ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <GitDeltaSummary status={status} />
          {status.stagedCount > 0 ? (
            <span className="text-muted-foreground text-xs">
              {gitT("stagedCount", { count: status.stagedCount })}
            </span>
          ) : null}
        </div>
      ) : (
        <Placeholder>{panelsT("workingTreeClean")}</Placeholder>
      )}
    </Section>
  );
};

const PullRequestSection = ({
  active,
  onShowPullRequest,
  projectPath,
}: {
  active: boolean;
  onShowPullRequest: () => void;
  projectPath: string;
}) => {
  const gitT = useTranslations("git");
  const panelsT = useTranslations("panels");
  const { data, error } = usePullRequestContext(projectPath, active);
  const pr = data?.current;

  let content: ReactNode;
  if (pr) {
    content = (
      <button
        className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onShowPullRequest}
        title={pr.title}
        type="button"
      >
        <PullRequestStatus pr={pr} />
        <span className="shrink-0 text-primary text-xs">#{pr.number}</span>
        <span className="min-w-0 truncate text-sm">{pr.title}</span>
      </button>
    );
  } else if (error) {
    content = <Placeholder>{error}</Placeholder>;
  } else if (data) {
    content = <Placeholder>{panelsT("noPullRequestForBranch")}</Placeholder>;
  } else {
    content = <Spinner className="size-4 text-muted-foreground" />;
  }

  return <Section title={gitT("pullRequest")}>{content}</Section>;
};

const RecentCommitsSection = ({
  active,
  onShowLog,
  projectPath,
}: {
  active: boolean;
  onShowLog: () => void;
  projectPath: string;
}) => {
  const gitT = useTranslations("git");
  const relativeTimeFormatter = useCommitTimeFormatter();
  const firstPage = useGitLogFirstPage(projectPath, active);
  const failed = firstPage.error !== undefined && !firstPage.loading;
  const commits = failed
    ? []
    : (firstPage.data?.commits.slice(0, RECENT_COMMIT_COUNT) ?? []);

  let content: ReactNode;
  if (commits.length > 0) {
    content = (
      <div className="-mx-3 space-y-1">
        {commits.map((commit) => (
          <GitLogRow
            commit={commit}
            key={commit.hash}
            relativeTimeFormatter={relativeTimeFormatter}
          />
        ))}
      </div>
    );
  } else if (failed) {
    content = <Placeholder>{gitT("unableToLoadLog")}</Placeholder>;
  } else if (firstPage.data) {
    content = <Placeholder>{gitT("noCommits")}</Placeholder>;
  } else {
    content = <Spinner className="size-4 text-muted-foreground" />;
  }

  return (
    <Section
      action={
        commits.length > 0 ? (
          <Button
            className="-mr-2"
            onClick={onShowLog}
            size="xs"
            variant="ghost"
          >
            {gitT("viewAll")}
          </Button>
        ) : null
      }
      title={gitT("recentCommits")}
    >
      {content}
    </Section>
  );
};

/**
 * The Git panel's overview: where the current branch stands against its
 * upstream and base, what is uncommitted, the branch's pull request and its
 * latest commits, with the actions that move them along.
 */
export const GitOverview = ({
  active,
  onShowTab,
  project,
}: {
  active: boolean;
  onShowTab: (tab: GitPanelTab) => void;
  project: ProjectConfig;
}) => {
  const panelsT = useTranslations("panels");
  // Full detail: the upstream, ahead/behind counts and base branch are only
  // in a full read.
  const { error, status } = useProjectGitStatus(project.path, {
    active,
    detail: "full",
    hostId: project.hostId,
  });

  if (!status) {
    return error ? (
      <AppShellPlaceholder message={error} />
    ) : (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  if (!status.isRepo) {
    return <AppShellPlaceholder message={panelsT("notGitRepository")} />;
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        <BranchSection project={project} status={status} />
        <GitActions
          branch={status.branch}
          projectId={project.id}
          projectPath={project.path}
          status={status}
        />
        <ChangesSection
          onOpenChanges={() => onShowTab("changes")}
          status={status}
        />
        <PullRequestSection
          active={active}
          onShowPullRequest={() => onShowTab("pull-request")}
          projectPath={project.path}
        />
        <RecentCommitsSection
          active={active}
          onShowLog={() => onShowTab("log")}
          projectPath={project.path}
        />
      </div>
    </ScrollArea>
  );
};
