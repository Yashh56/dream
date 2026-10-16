import assert from "node:assert/strict";
import { test } from "vitest";
import type { ProjectGitStatusResponse } from "@/types/ide";
import type { PullRequestSummary } from "../pull-requests/api";
import { getGitNextStep } from "./next-step";

const status = (
  overrides: Partial<ProjectGitStatusResponse> = {},
): ProjectGitStatusResponse => ({
  addedLines: 0,
  aheadCount: 0,
  baseBranch: "main",
  behindCount: 0,
  branch: "feature",
  changes: [],
  fileCount: 0,
  hasStagedChanges: false,
  hasUnstagedChanges: false,
  isRepo: true,
  remoteName: "origin",
  removedLines: 0,
  repoRoot: "/repo",
  stagedCount: 0,
  unstagedCount: 0,
  upstreamBranch: "origin/feature",
  ...overrides,
});

const pr = (
  state: PullRequestSummary["state"],
  draft = false,
): PullRequestSummary => ({
  author: "someone",
  draft,
  number: 12,
  state,
  title: "Feature",
  updatedAt: "2026-10-01T00:00:00Z",
  url: "https://github.com/acme/app/pull/12",
});

test("no repository, no step", () => {
  assert.equal(
    getGitNextStep({ pullRequest: null, status: status({ isRepo: false }) }),
    null,
  );
  assert.equal(getGitNextStep({ pullRequest: null, status: null }), null);
});

test("uncommitted files come first, whatever else is pending", () => {
  assert.deepEqual(
    getGitNextStep({
      pullRequest: pr("open"),
      status: status({ aheadCount: 3, fileCount: 2 }),
    }),
    { kind: "commit", fileCount: 2 },
  );
});

test("commits ahead of the upstream are pushed", () => {
  assert.deepEqual(
    getGitNextStep({
      pullRequest: pr("open"),
      status: status({ aheadCount: 3 }),
    }),
    { kind: "push", aheadCount: 3 },
  );
});

test("a branch without an upstream is published when there is a remote", () => {
  assert.deepEqual(
    getGitNextStep({
      pullRequest: undefined,
      status: status({ upstreamBranch: null }),
    }),
    { kind: "publish" },
  );
});

test("an open pull request is the step once everything is pushed", () => {
  const open = pr("open", true);
  assert.deepEqual(getGitNextStep({ pullRequest: open, status: status() }), {
    kind: "view-pr",
    pullRequest: open,
  });
});

test("a pushed feature branch without a pull request opens one", () => {
  assert.deepEqual(getGitNextStep({ pullRequest: null, status: status() }), {
    kind: "create-pr",
  });
  assert.deepEqual(
    getGitNextStep({ pullRequest: pr("closed"), status: status() }),
    { kind: "create-pr" },
  );
});

test("pull request steps wait until the pull request is known", () => {
  assert.equal(
    getGitNextStep({ pullRequest: undefined, status: status() }),
    null,
  );
});

test("no pull request from the base branch or a detached HEAD", () => {
  assert.equal(
    getGitNextStep({
      pullRequest: null,
      status: status({ branch: "main", upstreamBranch: "origin/main" }),
    }),
    null,
  );
  assert.equal(
    getGitNextStep({
      pullRequest: null,
      status: status({ branch: null, upstreamBranch: null, remoteName: null }),
    }),
    null,
  );
});

test("a merged pull request finishes a worktree and leaves a branch be", () => {
  assert.deepEqual(
    getGitNextStep({
      pullRequest: pr("merged"),
      status: status(),
      worktreeBaseBranch: "main",
    }),
    { kind: "remove-worktree" },
  );
  assert.equal(
    getGitNextStep({ pullRequest: pr("merged"), status: status() }),
    null,
  );
});

test("a worktree with no remote merges into its base", () => {
  const local = status({ remoteName: null, upstreamBranch: null });
  assert.deepEqual(
    getGitNextStep({
      pullRequest: undefined,
      status: local,
      worktreeBaseBranch: "develop",
    }),
    { kind: "merge-worktree", baseBranch: "develop" },
  );
  assert.deepEqual(
    getGitNextStep({
      pullRequest: undefined,
      status: local,
      worktreeBaseBranch: null,
    }),
    { kind: "merge-worktree", baseBranch: "main" },
  );
});
