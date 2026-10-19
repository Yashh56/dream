import { Check, Copy } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ProjectGitLogCommit } from "@/types/ide";
import { formatLastActiveTime } from "../activity-time";
import { buildGitGraph, type GitGraphRow } from "./log-graph";
import {
  type GitGraphLayout,
  GitLogGraphCell,
  getGitGraphLayout,
} from "./log-graph-cell";
import { useGitHistory } from "./use-git-history";

const COPIED_FEEDBACK_MS = 1500;

// An empty message falls back to the translated generic error when rendered.
const getErrorMessage = (error: unknown) => getApiErrorMessage(error, "");

/** Formats a commit's age the way the log rows show it. */
export const useCommitTimeFormatter = () => {
  const locale = useLocale();
  return useMemo(
    () =>
      new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" }),
    [locale],
  );
};

const matchesCommit = (commit: ProjectGitLogCommit, query: string) =>
  commit.subject.toLowerCase().includes(query) ||
  commit.authorName.toLowerCase().includes(query) ||
  commit.authorEmail.toLowerCase().includes(query) ||
  commit.hash.toLowerCase().startsWith(query) ||
  commit.refs.some((ref) => ref.toLowerCase().includes(query));

export const GitLogRow = ({
  commit,
  graph,
  relativeTimeFormatter,
}: {
  commit: ProjectGitLogCommit;
  /** The commit's row of the graph, and how the graph is drawn. */
  graph?: { layout: GitGraphLayout; row: GitGraphRow };
  relativeTimeFormatter: Intl.RelativeTimeFormat;
}) => {
  const gitT = useTranslations("git");
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(commit.hash);
    } catch {
      return;
    }

    setCopied(true);
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, COPIED_FEEDBACK_MS);
  }, [commit.hash]);

  const authoredAt = Date.parse(commit.authorDate);
  const tooltip = [
    commit.subject,
    `${commit.shortHash} · ${commit.authorName}${
      commit.authorEmail ? ` <${commit.authorEmail}>` : ""
    }`,
    Number.isNaN(authoredAt) ? "" : new Date(authoredAt).toLocaleString(),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="group relative flex min-w-0 rounded-md hover:bg-surface-50 dark:hover:bg-surface-900">
      {graph ? <GitLogGraphCell layout={graph.layout} row={graph.row} /> : null}
      <div
        className={cn("min-w-0 flex-1 py-2 pr-3", graph ? "pl-1" : "pl-3")}
        title={tooltip}
      >
        <div className="flex min-w-0 items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate text-sm leading-5">
            {commit.subject || gitT("noSubject")}
          </p>
          <span className="shrink-0 whitespace-nowrap text-muted-foreground text-xs leading-5 group-hover:opacity-0 group-has-[:focus-visible]:opacity-0">
            {formatLastActiveTime(commit.authorDate, relativeTimeFormatter)}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 pr-8 text-muted-foreground text-xs leading-5">
          <span className="shrink-0 font-mono">{commit.shortHash}</span>
          {commit.refs.map((ref) => (
            <span
              className="max-w-32 shrink-0 truncate rounded border border-border px-1 font-medium text-[11px] leading-4 text-foreground/80"
              key={ref}
            >
              {ref.replace(/^tag: /, "")}
            </span>
          ))}
          <span className="min-w-0 truncate">{commit.authorName}</span>
        </div>
      </div>
      <div className="-translate-y-1/2 absolute top-1/2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
        <Button
          aria-label={gitT("copyCommitHash")}
          className="size-7 rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={handleCopy}
          size="icon-sm"
          title={gitT("copyCommitHash")}
          type="button"
          variant="ghost"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
};

/** The commit history of the project's HEAD, searchable, a page at a time. */
export const GitLog = ({
  active,
  projectPath,
  hostId,
}: {
  active: boolean;
  projectPath: string;
  hostId: string;
}) => {
  const gitT = useTranslations("git");
  const panelsT = useTranslations("panels");
  const pullRequestsT = useTranslations("pullRequests");
  const relativeTimeFormatter = useCommitTimeFormatter();
  const {
    commits,
    hasMore,
    loading,
    loadingMore,
    error: loadError,
    loadMore: handleLoadMore,
  } = useGitHistory(projectPath, hostId, active);
  const error = loadError === undefined ? null : getErrorMessage(loadError);
  const [searchQuery, setSearchQuery] = useState("");

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredCommits = useMemo(
    () =>
      normalizedQuery
        ? commits.filter((commit) => matchesCommit(commit, normalizedQuery))
        : commits,
    [commits, normalizedQuery],
  );

  // The graph needs every commit in order; a search shows matches alone.
  const graph = useMemo(
    () => (normalizedQuery ? null : buildGitGraph(commits)),
    [commits, normalizedQuery],
  );
  const graphLayout = useMemo(
    () => (graph ? getGitGraphLayout(graph.laneCount) : null),
    [graph],
  );

  const errorMessage = error === null ? null : error || gitT("unableToLoadLog");
  let emptyMessage: string | null = null;
  if (!loading && filteredCommits.length === 0) {
    emptyMessage =
      errorMessage ??
      (normalizedQuery ? gitT("noMatchingCommits") : gitT("noCommits"));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-3">
        <SearchInput
          clearLabel={panelsT("clearSearch")}
          onValueChange={setSearchQuery}
          placeholder={gitT("searchCommits")}
          value={searchQuery}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* With the graph, rows touch so its lines run on unbroken. */}
        <div className={cn("px-2 pb-3", !graph && "space-y-1")}>
          {loading && commits.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center p-4">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : emptyMessage ? (
            <div
              className={cn(
                "flex min-h-32 items-center justify-center p-4 text-center text-sm",
                errorMessage ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <p className="min-w-0 break-words">{emptyMessage}</p>
            </div>
          ) : (
            filteredCommits.map((commit, index) => {
              const graphRow = graph?.rows[index];
              return (
                <GitLogRow
                  commit={commit}
                  graph={
                    graphRow && graphLayout
                      ? { layout: graphLayout, row: graphRow }
                      : undefined
                  }
                  key={commit.hash}
                  relativeTimeFormatter={relativeTimeFormatter}
                />
              );
            })
          )}
          {hasMore && !loading && !normalizedQuery ? (
            <div className="flex justify-center pt-1">
              <Button
                disabled={loadingMore}
                onClick={handleLoadMore}
                size="sm"
                type="button"
                variant="ghost"
              >
                {loadingMore ? <Spinner className="size-3.5" /> : null}
                {pullRequestsT("loadMore")}
              </Button>
            </div>
          ) : null}
          {errorMessage && commits.length > 0 ? (
            <p className="px-2 text-destructive text-sm">{errorMessage}</p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
};
