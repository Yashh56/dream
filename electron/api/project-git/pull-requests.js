/**
 * GitHub pull requests for a project, on its host.
 *
 * One module owns everything Dream asks GitHub about pull requests: which
 * repository a folder is (looked up once and remembered briefly), which pull
 * request belongs to a branch (one rule, used by the PR panel and the
 * worktree compare alike), how a pull request's checks add up, and every
 * action the PR panel takes (list, read, comment, review, merge...).
 *
 * It talks to GitHub through the `gh` CLI and to the repository through git,
 * both passed in as ports: the CLI and git in production, fakes in tests.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGhCommand, runGitCommand } from "./core.js";
import { ensureProjectDirectory } from "./files.js";

/** How long a folder's repository lookup is remembered. */
const REPOSITORY_TTL_MS = 30_000;
/** GitHub API calls can hang on the network; they give up after this. */
const GH_TIMEOUT_MS = 45_000;
const WRITERS = ["ADMIN", "MAINTAIN", "WRITE"];

const FAILED_CHECK_STATES = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);
const PASSED_CHECK_STATES = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/**
 * One check's outcome, from GitHub's conclusion, state or status (whichever
 * the check run or status context has).
 * @param {{ conclusion?: string, state?: string, status?: string }} check
 * @returns {"failed" | "pending" | "passed"}
 */
export const checkOutcome = (check) => {
  const state = (
    check.conclusion ||
    check.state ||
    check.status ||
    "PENDING"
  ).toUpperCase();
  if (FAILED_CHECK_STATES.has(state)) return "failed";
  return PASSED_CHECK_STATES.has(state) ? "passed" : "pending";
};

/**
 * A pull request's checks summed up: one outcome for them all (unavailable
 * when GitHub would not say, none when there are none), how many failed,
 * and each check with its name, link and outcome.
 * @param {unknown[] | null | undefined} rollup GitHub's statusCheckRollup.
 */
export const summarizeChecks = (rollup) => {
  if (!Array.isArray(rollup)) {
    return { failedCount: 0, items: [], outcome: "unavailable" };
  }
  const items = rollup.map((raw) => {
    const check = /** @type {Record<string, string | undefined>} */ (raw ?? {});
    const name = check.name ?? check.context ?? "";
    const url = check.detailsUrl || check.targetUrl || null;
    return {
      key: check.id ?? `${name}:${url ?? ""}`,
      name,
      outcome: checkOutcome(check),
      url,
    };
  });
  const failedCount = items.filter((item) => item.outcome === "failed").length;
  return {
    failedCount,
    items,
    outcome:
      items.length === 0
        ? "none"
        : failedCount > 0
          ? "failed"
          : items.some((item) => item.outcome === "pending")
            ? "pending"
            : "passed",
  };
};

/** The fields the PR panel lists a pull request by. */
export const pullRequestSummary = (pr) => ({
  number: pr.number,
  title: pr.title,
  url: pr.html_url,
  state: pr.merged_at || pr.pull_request?.merged_at ? "merged" : pr.state,
  draft: Boolean(pr.draft),
  author: pr.user?.login ?? "",
  authorAvatarUrl: pr.user?.avatar_url ?? "",
  commit: pr.head?.sha,
  updatedAt: pr.updated_at,
});

/** `host` and `owner/name` of a git remote URL (https, ssh or scp form). */
export const remoteRepository = (url) => {
  const match = url
    .trim()
    .match(
      /^(?:https?:\/\/|ssh:\/\/)?(?:[^/@]+@)?([^/:]+)[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/,
    );
  return match ? { host: match[1], name: match[2] } : null;
};

const required = (value, label) => {
  if (value === undefined || value === null)
    throw new Error(`${label} is required.`);
  return value;
};

/**
 * @param {{
 *   gh?: (cwd: string, args: string[]) => Promise<{ stdout: string }>,
 *   git?: typeof runGitCommand,
 *   now?: () => number,
 * }} [ports]
 */
export const createGitHubPullRequests = ({
  gh = (cwd, args) => runGhCommand(cwd, args, { timeoutMs: GH_TIMEOUT_MS }),
  git = runGitCommand,
  now = Date.now,
} = {}) => {
  /** @type {Map<string, { at: number, promise: Promise<any> }>} */
  const repositories = new Map();

  const ghJson = async (cwd, args) =>
    JSON.parse((await gh(cwd, args)).stdout || "null");

  /** A GitHub REST call through `gh api`; a body goes in a private file. */
  const api = async (cwd, host, endpoint, method = "GET", body) => {
    const args = ["api", "--hostname", host, "--method", method, endpoint];
    if (body === undefined) return ghJson(cwd, args);
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "dream-code-pr-"),
    );
    const file = path.join(directory, "body.json");
    try {
      await fs.writeFile(file, JSON.stringify(body), { mode: 0o600 });
      return await ghJson(cwd, [...args, "--input", file]);
    } finally {
      await fs.unlink(file).catch(() => {});
      await fs.rmdir(directory).catch(() => {});
    }
  };

  /**
   * The GitHub repository a folder is, remembered for a short while (and
   * shared while it is being looked up); a failed lookup is not kept.
   */
  const repository = (cwd) => {
    const cached = repositories.get(cwd);
    if (cached && now() - cached.at < REPOSITORY_TTL_MS) {
      return cached.promise;
    }
    const promise = ghJson(cwd, [
      "repo",
      "view",
      "--json",
      "nameWithOwner,url,viewerPermission",
    ]).then((repo) => {
      const host = new URL(repo.url).hostname;
      return {
        host,
        key: `${host}/${repo.nameWithOwner}`,
        name: repo.nameWithOwner,
        permission: repo.viewerPermission,
      };
    });
    repositories.set(cwd, { at: now(), promise });
    promise.catch(() => {
      if (repositories.get(cwd)?.promise === promise) repositories.delete(cwd);
    });
    return promise;
  };

  /**
   * True when every commit on the local branch is already part of the PR
   * head: the branch tip is the PR head, or behind it.
   */
  const branchHasNoWorkBeyond = async (cwd, branch, prHeadSha) => {
    if (!prHeadSha) return false;
    const tip = await git(cwd, ["rev-parse", `refs/heads/${branch}`], {
      allowFailure: true,
    });
    if (!tip.ok) return false;
    if (tip.stdout.trim() === prHeadSha) return true;
    const ancestor = await git(
      cwd,
      ["merge-base", "--is-ancestor", `refs/heads/${branch}`, prHeadSha],
      { allowFailure: true },
    );
    return ancestor.ok;
  };

  /**
   * The pull request that belongs to `branch`, as GitHub's raw object, or
   * null. Its head must be the branch on the repository the branch pushes
   * to (a fork's PR of the same name is not it). An open one wins. A closed
   * or merged one belongs to the branch only while the branch has no newer
   * work: long-lived branches (dev, release/...) are reused after their PR
   * merges and must not show it forever.
   */
  const branchPullRequest = async (cwd, branch, repo = null) => {
    const repoInfo = repo ?? (await repository(cwd));
    const remoteResult = await git(cwd, [
      "for-each-ref",
      "--format=%(push:remotename)%09%(push:remoteref)%09%(upstream:remotename)%09%(upstream:remoteref)",
      `refs/heads/${branch}`,
    ]);
    const [pushRemote, pushRef, upstreamRemote, upstreamRef] = (
      remoteResult.stdout ?? ""
    )
      .replace(/[\r\n]+$/, "")
      .split("\t");
    const remote = pushRemote || upstreamRemote || "origin";
    const headBranch = (
      pushRef ||
      (remote === upstreamRemote ? upstreamRef : "") ||
      `refs/heads/${branch}`
    ).replace(/^refs\/heads\//, "");
    const url = await git(cwd, ["remote", "get-url", remote], {
      allowFailure: true,
    });
    const headRepo = url.ok ? remoteRepository(url.stdout) : null;
    if (headRepo?.host.toLowerCase() !== repoInfo.host.toLowerCase()) {
      return null;
    }

    const query = new URLSearchParams({
      direction: "desc",
      head: `${headRepo.name.split("/")[0]}:${headBranch}`,
      per_page: "100",
      sort: "updated",
    });
    const pulls = `repos/${repoInfo.name}/pulls?${query}`;
    const exactHead = (pr) =>
      pr.head?.repo?.full_name?.toLowerCase() === headRepo.name.toLowerCase();
    const open = await api(cwd, repoInfo.host, `${pulls}&state=open`);
    const current = open.find(exactHead);
    if (current) return current;
    const closed = (
      await api(cwd, repoInfo.host, `${pulls}&state=closed`)
    ).filter(exactHead);
    for (const pr of closed) {
      if (await branchHasNoWorkBeyond(cwd, branch, pr.head?.sha)) {
        return pr;
      }
    }
    return null;
  };

  /** One PR panel action (see code-pull-request-schemas.js). */
  const execute = async (input) => {
    const cwd = input.projectPath;
    await ensureProjectDirectory(cwd);
    const repo = await repository(cwd);
    if (input.repository && input.repository !== repo.key) {
      throw new Error("The repository changed. Refresh before continuing.");
    }
    const base = `repos/${repo.name}`;
    const get = (endpoint) => api(cwd, repo.host, endpoint);
    const write = (endpoint, method, body) =>
      api(cwd, repo.host, endpoint, method, body);

    if (input.action === "context") {
      const branchResult = await git(
        cwd,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        { allowFailure: true },
      );
      const branch = branchResult.ok ? branchResult.stdout.trim() : null;
      const current = branch
        ? await branchPullRequest(cwd, branch, repo)
        : null;
      return {
        branch,
        current: current ? pullRequestSummary(current) : null,
        repository: repo.key,
      };
    }
    if (input.action === "list") {
      const state =
        input.state === "all"
          ? ""
          : input.state === "closed"
            ? "is:closed is:unmerged"
            : `is:${input.state}`;
      const term = input.search.trim().replace(/["\\]/g, " ");
      const search = /^#?\d+$/.test(term)
        ? term.replace("#", "")
        : term
          ? `"${term}" in:title`
          : "";
      const query = new URLSearchParams({
        order: "desc",
        page: String(input.page),
        per_page: "30",
        q: `repo:${repo.name} is:pr ${state} ${search}`,
        sort: "updated",
      });
      const result = await get(`search/issues?${query}`);
      return {
        hasMore: input.page * 30 < Math.min(result.total_count, 1000),
        items: result.items.map(pullRequestSummary),
      };
    }

    const number = required(input.number, "Pull request number");
    const prPath = `${base}/pulls/${number}`;
    if (["files", "comments", "reviews", "threads"].includes(input.action)) {
      if (input.action === "files") {
        const current = await get(prPath);
        if (current.head.sha !== required(input.commit, "Displayed commit"))
          throw new Error(
            "New commits were pushed. Refresh this PR before loading its diff.",
          );
      }
      const endpoint =
        input.action === "comments"
          ? `${base}/issues/${number}/comments`
          : `${prPath}/${input.action === "threads" ? "comments" : input.action}`;
      const items = await get(`${endpoint}?per_page=100&page=${input.page}`);
      if (
        input.action === "files" &&
        (await get(prPath)).head.sha !== input.commit
      )
        throw new Error(
          "The PR changed while loading its diff. Refresh to continue.",
        );
      return { hasMore: items.length === 100, items };
    }

    const pr = await get(prPath);
    if (input.action === "mergeInfo") {
      const settings = await get(base);
      return {
        ...pullRequestSummary(pr),
        base: pr.base.ref,
        canMerge: WRITERS.includes(repo.permission),
        head: pr.head.ref,
        methods: [
          settings.allow_merge_commit && "merge",
          settings.allow_squash_merge && "squash",
          settings.allow_rebase_merge && "rebase",
        ].filter(Boolean),
      };
    }
    if (input.action === "merge") {
      if (pr.state !== "open" || pr.draft)
        throw new Error("Only open, non-draft pull requests can be merged.");
      const commit = required(input.commit, "PR head commit");
      if (pr.head.sha !== commit)
        throw new Error("This PR changed on GitHub. Refresh before merging.");
      const settings = await get(base);
      const method = required(input.mergeMethod, "Merge method");
      const allowed = {
        merge: settings.allow_merge_commit,
        rebase: settings.allow_rebase_merge,
        squash: settings.allow_squash_merge,
      };
      if (!allowed[method])
        throw new Error(
          "This merge method is not enabled for this repository.",
        );
      const result = await write(`${prPath}/merge`, "PUT", {
        merge_method: method,
        sha: commit,
      });
      if (!result.merged)
        throw new Error(result.message || "GitHub could not merge this PR.");
      return result;
    }
    if (input.action === "checkout") {
      const status = await git(cwd, ["status", "--porcelain=v1"]);
      if (status.stdout.trim())
        throw new Error(
          "Commit or stash local changes before checking out a PR branch.",
        );
      await gh(cwd, [
        "pr",
        "checkout",
        String(number),
        "--repo",
        `${repo.host}/${repo.name}`,
      ]);
      return { checkedOut: true };
    }
    if (input.action === "detail") {
      const [viewer, checks] = await Promise.all([
        get("user"),
        ghJson(cwd, [
          "pr",
          "view",
          String(number),
          "--repo",
          `${repo.host}/${repo.name}`,
          "--json",
          "statusCheckRollup",
        ]).catch(() => null),
      ]);
      return {
        ...pullRequestSummary(pr),
        additions: pr.additions,
        base: pr.base.ref,
        body: pr.body ?? "",
        canEdit:
          viewer.login === pr.user?.login || WRITERS.includes(repo.permission),
        changedFiles: pr.changed_files,
        checks: summarizeChecks(checks?.statusCheckRollup),
        commit: pr.head.sha,
        deletions: pr.deletions,
        head: pr.head.ref,
        reviewers: pr.requested_reviewers.map((user) => user.login),
        viewer: viewer.login,
      };
    }
    if (input.action === "edit") {
      if (input.title === undefined && input.body === undefined)
        throw new Error("Provide a title or description to update.");
      if (pr.updated_at !== required(input.updatedAt, "Original update time"))
        throw new Error(
          "This PR changed on GitHub. Refresh and review your edits before saving.",
        );
      return write(prPath, "PATCH", {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
      });
    }

    const body = input.body?.trim() ?? "";
    if (!body && !(input.action === "review" && input.event === "APPROVE"))
      throw new Error("Write a comment before posting.");
    if (input.action === "comment")
      return write(`${base}/issues/${number}/comments`, "POST", { body });
    if (input.action === "editComment") {
      const endpoint = `${base}/issues/comments/${required(input.commentId, "Comment")}`;
      const [comment, viewer] = await Promise.all([get(endpoint), get("user")]);
      if (
        !comment.issue_url.endsWith(`/issues/${number}`) ||
        comment.user.login !== viewer.login
      )
        throw new Error("You can only edit your own comments on this PR.");
      if (
        comment.updated_at !== required(input.updatedAt, "Original update time")
      )
        throw new Error("This comment changed. Refresh before saving.");
      return write(endpoint, "PATCH", { body });
    }
    if (input.action === "reply") {
      return write(
        `${prPath}/comments/${required(input.commentId, "Thread")}/replies`,
        "POST",
        { body },
      );
    }
    if (pr.head.sha !== required(input.commit, "Reviewed commit"))
      throw new Error(
        "New commits were pushed. Refresh the diff before posting your review.",
      );
    if (input.action === "inline") {
      return write(`${prPath}/comments`, "POST", {
        body,
        commit_id: input.commit,
        line: required(input.line, "Line"),
        path: required(input.path, "File"),
        side: required(input.side, "Diff side"),
      });
    }
    if (input.action === "review")
      return write(`${prPath}/reviews`, "POST", {
        body,
        commit_id: input.commit,
        event: required(input.event, "Review action"),
      });
    throw new Error("Unsupported action.");
  };

  return { branchPullRequest, execute, repository };
};

/** The host's pull requests, over the real `gh` and git. */
export const gitHubPullRequests = createGitHubPullRequests();
