// GitHub pull requests over fake `gh` and git ports: which PR is a branch's,
// how checks add up, and how often the repository is looked up.
import assert from "node:assert/strict";
import os from "node:os";
import { test } from "vitest";
import {
  checkOutcome,
  createGitHubPullRequests,
  summarizeChecks,
} from "./pull-requests.js";

const CWD = os.tmpdir();
const REPO = {
  nameWithOwner: "acme/app",
  url: "https://github.com/acme/app",
  viewerPermission: "WRITE",
};

const pr = (
  number,
  { headRepo = "acme/app", sha = `sha${number}`, ...rest } = {},
) => ({
  draft: false,
  head: { ref: "feature", repo: { full_name: headRepo }, sha },
  html_url: `https://github.com/acme/app/pull/${number}`,
  merged_at: null,
  number,
  state: "open",
  title: `PR ${number}`,
  updated_at: "2026-10-16T00:00:00Z",
  user: { login: "me" },
  ...rest,
});

/**
 * Ports a test scripts: `gh api` answers by endpoint (open and closed pull
 * lists), `gh repo view` with REPO, and git answers the branch's remote and
 * whether its tip is the PR head or behind it.
 */
const createPorts = ({
  open = [],
  closed = [],
  remoteUrl = "git@github.com:acme/app.git",
  tip = "tip",
  ancestorOf = [],
  checks,
} = {}) => {
  const calls = { api: [], repoView: 0 };
  let time = 0;
  const gh = async (_cwd, args) => {
    if (args[0] === "repo") {
      calls.repoView += 1;
      return { stdout: JSON.stringify(REPO) };
    }
    if (args[0] === "pr" && args[1] === "view") {
      return { stdout: JSON.stringify({ statusCheckRollup: checks }) };
    }
    const endpoint = args[args.indexOf("--method") + 2];
    calls.api.push(endpoint);
    if (endpoint.includes("state=open"))
      return { stdout: JSON.stringify(open) };
    if (endpoint.includes("state=closed"))
      return { stdout: JSON.stringify(closed) };
    if (endpoint === "user") return { stdout: JSON.stringify({ login: "me" }) };
    if (/pulls\/\d+$/.test(endpoint)) {
      return {
        stdout: JSON.stringify({
          ...pr(7),
          additions: 1,
          base: { ref: "main" },
          body: "",
          changed_files: 1,
          deletions: 0,
          requested_reviewers: [],
        }),
      };
    }
    throw new Error(`unexpected gh call ${endpoint}`);
  };
  const git = async (_cwd, args) => {
    if (args[0] === "symbolic-ref") return { ok: true, stdout: "feature\n" };
    if (args[0] === "for-each-ref") {
      return { ok: true, stdout: "origin\trefs/heads/feature\t\t\n" };
    }
    if (args[0] === "remote") return { ok: true, stdout: `${remoteUrl}\n` };
    if (args[0] === "rev-parse") return { ok: true, stdout: `${tip}\n` };
    if (args[0] === "merge-base") {
      return { ok: ancestorOf.includes(args[3]), stdout: "" };
    }
    throw new Error(`unexpected git call ${args.join(" ")}`);
  };
  const pullRequests = createGitHubPullRequests({
    gh,
    git,
    now: () => time,
  });
  return {
    calls,
    pullRequests,
    wait: (ms) => {
      time += ms;
    },
  };
};

test("an open pull request from the branch's own repository is the branch's", async () => {
  const { pullRequests } = createPorts({
    open: [pr(1, { headRepo: "someone/app" }), pr(2)],
  });
  const found = await pullRequests.branchPullRequest(CWD, "feature");
  assert.equal(found?.number, 2);
});

test("a closed pull request counts only while the branch has no newer work", async () => {
  const merged = pr(3, {
    merged_at: "2026-10-01T00:00:00Z",
    sha: "merged-head",
    state: "closed",
  });

  // The branch tip is the merged head: it is still that PR's branch.
  const same = createPorts({ closed: [merged], tip: "merged-head" });
  assert.equal(
    (await same.pullRequests.branchPullRequest(CWD, "feature"))?.number,
    3,
  );

  // The branch moved on (a long-lived branch reused after the merge).
  const movedOn = createPorts({ closed: [merged], tip: "newer" });
  assert.equal(
    await movedOn.pullRequests.branchPullRequest(CWD, "feature"),
    null,
  );

  // Behind the merged head still counts.
  const behind = createPorts({
    ancestorOf: ["merged-head"],
    closed: [merged],
    tip: "older",
  });
  assert.equal(
    (await behind.pullRequests.branchPullRequest(CWD, "feature"))?.number,
    3,
  );
});

test("a branch that pushes to another host has no pull request here", async () => {
  const { calls, pullRequests } = createPorts({
    open: [pr(1)],
    remoteUrl: "git@gitlab.com:acme/app.git",
  });
  assert.equal(await pullRequests.branchPullRequest(CWD, "feature"), null);
  assert.deepEqual(calls.api, []);
});

test("the panel's context and the worktree compare ask the same question", async () => {
  const { pullRequests } = createPorts({ open: [pr(5)] });
  const context = await pullRequests.execute({
    action: "context",
    projectPath: CWD,
  });
  assert.deepEqual(
    { branch: context.branch, number: context.current?.number },
    { branch: "feature", number: 5 },
  );
  assert.equal(context.repository, "github.com/acme/app");
});

test("the repository is looked up once for a while, then again", async () => {
  const { calls, pullRequests, wait } = createPorts();
  await Promise.all([
    pullRequests.repository(CWD),
    pullRequests.repository(CWD),
  ]);
  await pullRequests.repository(CWD);
  assert.equal(calls.repoView, 1);

  wait(30_001);
  await pullRequests.repository(CWD);
  assert.equal(calls.repoView, 2);
});

test("an action for a repository that is no longer the folder's is refused", async () => {
  const { pullRequests } = createPorts();
  await assert.rejects(
    pullRequests.execute({
      action: "list",
      page: 1,
      projectPath: CWD,
      repository: "github.com/acme/other",
      search: "",
      state: "open",
    }),
    /repository changed/,
  );
});

test("check outcomes, from whichever field a check reports", () => {
  assert.equal(checkOutcome({ conclusion: "TIMED_OUT" }), "failed");
  assert.equal(checkOutcome({ state: "error" }), "failed");
  assert.equal(checkOutcome({ conclusion: "SKIPPED" }), "passed");
  assert.equal(checkOutcome({ status: "IN_PROGRESS" }), "pending");
  assert.equal(checkOutcome({}), "pending");
});

test("checks add up to one outcome with a failed count", () => {
  assert.deepEqual(summarizeChecks(null), {
    failedCount: 0,
    items: [],
    outcome: "unavailable",
  });
  assert.equal(summarizeChecks([]).outcome, "none");
  assert.equal(
    summarizeChecks([{ conclusion: "SUCCESS" }, { status: "QUEUED" }]).outcome,
    "pending",
  );
  const failed = summarizeChecks([
    {
      conclusion: "FAILURE",
      detailsUrl: "https://ci/1",
      id: "a",
      name: "lint",
    },
    { conclusion: "SUCCESS", context: "build", targetUrl: "https://ci/2" },
    { conclusion: "STALE", name: "e2e" },
  ]);
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.failedCount, 2);
  assert.deepEqual(failed.items[1], {
    key: "build:https://ci/2",
    name: "build",
    outcome: "passed",
    url: "https://ci/2",
  });
});

test("a pull request's detail carries its checks summed up", async () => {
  const { pullRequests } = createPorts({
    checks: [{ conclusion: "FAILURE", name: "lint" }],
  });
  const detail = await pullRequests.execute({
    action: "detail",
    number: 7,
    page: 1,
    projectPath: CWD,
    search: "",
    state: "open",
  });
  assert.equal(detail.checks.outcome, "failed");
  assert.equal(detail.checks.failedCount, 1);
  assert.equal(detail.canEdit, true);
});
