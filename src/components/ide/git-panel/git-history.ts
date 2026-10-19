/** Loaded Git history, including the lifetime of every page after the shared first one. */
import type { ResourceSnapshot } from "@/lib/project-resource-cache";
import type { ProjectGitLogCommit, ProjectGitLogResponse } from "@/types/ide";

export const GIT_LOG_PAGE_SIZE = 100;

interface FirstPage {
  getSnapshot(): ResourceSnapshot<ProjectGitLogResponse>;
  subscribe(
    listener: () => void,
    active: boolean,
  ): {
    setActive(active: boolean): void;
    unsubscribe(): void;
  };
}

export interface GitHistorySnapshot {
  commits: ProjectGitLogCommit[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
}

const appendUnique = (
  previous: ProjectGitLogCommit[],
  incoming: ProjectGitLogCommit[],
) => {
  const seen = new Set(previous.map((commit) => commit.hash));
  const next = [...previous];
  for (const commit of incoming) {
    if (seen.has(commit.hash)) continue;
    seen.add(commit.hash);
    next.push(commit);
  }
  return next;
};

export function createGitHistory({
  firstPage,
  loadPage,
}: {
  firstPage: FirstPage;
  loadPage: (
    skip: number,
    signal: AbortSignal,
  ) => Promise<ProjectGitLogResponse>;
}) {
  let first = firstPage.getSnapshot();
  let offset = first.data?.commits.length ?? 0;
  let active = false;
  let pending: AbortController | null = null;
  let subscription: ReturnType<FirstPage["subscribe"]> | null = null;
  const listeners = new Set<() => void>();
  let snapshot: GitHistorySnapshot = {
    commits:
      first.error === undefined
        ? appendUnique([], first.data?.commits ?? [])
        : [],
    hasMore: first.error === undefined && (first.data?.hasMore ?? false),
    loading: first.loading || first.version === null,
    loadingMore: false,
    error: first.loading ? undefined : first.error,
  };

  const publish = (patch: Partial<GitHistorySnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  const cancelMore = () => {
    pending?.abort();
    pending = null;
  };

  const updateFirst = () => {
    const next = firstPage.getSnapshot();
    if (next === first) return;
    const replaced =
      next.data !== first.data ||
      next.version !== first.version ||
      (first.fresh && !next.fresh) ||
      (!first.loading && next.loading) ||
      next.error !== first.error;
    first = next;
    if (replaced) {
      cancelMore();
      offset = first.data?.commits.length ?? 0;
      publish({
        commits:
          first.error === undefined
            ? appendUnique([], first.data?.commits ?? [])
            : [],
        hasMore: first.error === undefined && (first.data?.hasMore ?? false),
        loading: first.loading || first.version === null,
        loadingMore: false,
        error: first.loading ? undefined : first.error,
      });
    } else {
      publish({ loading: first.loading || first.version === null });
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!subscription) {
        subscription = firstPage.subscribe(updateFirst, active);
        updateFirst();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          subscription?.unsubscribe();
          subscription = null;
          cancelMore();
          if (snapshot.loadingMore) publish({ loadingMore: false });
        }
      };
    },
    setActive(next: boolean) {
      active = next;
      if (!active) {
        cancelMore();
        if (snapshot.loadingMore) publish({ loadingMore: false });
      }
      subscription?.setActive(next);
      updateFirst();
    },
    async loadMore() {
      updateFirst();
      if (
        !active ||
        pending ||
        !first.fresh ||
        first.loading ||
        first.error !== undefined ||
        !first.data ||
        !snapshot.hasMore
      )
        return;
      const controller = new AbortController();
      pending = controller;
      publish({ loadingMore: true, error: undefined });
      try {
        const page = await loadPage(offset, controller.signal);
        updateFirst();
        if (pending !== controller || controller.signal.aborted) return;
        // The offset counts host rows, not deduplicated visible commits.
        offset += page.commits.length;
        publish({
          commits: appendUnique(snapshot.commits, page.commits),
          hasMore: page.hasMore && page.commits.length > 0,
        });
      } catch (error) {
        if (pending === controller && !controller.signal.aborted)
          publish({ error });
      } finally {
        if (pending === controller) {
          pending = null;
          publish({ loadingMore: false });
        }
      }
    },
  };
}
