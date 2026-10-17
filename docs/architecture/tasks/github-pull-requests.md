# GitHub pull requests in one module behind a GitHub port

From the October 16 architecture review (candidate 7).

## GHPR-01: One module owns pull requests on the host side

Status: implemented

Problem and trigger: pull requests had no single module in the main
process.

- **Two rules for "this branch's pull request", which can disagree.**
  - The PR panel's `context` action (`code-pull-request-routes.js`) matches
    the exact head repository through the REST API. It skips a closed or
    merged PR once the branch has newer work, so long-lived branches
    (`dev`, `release/...`) do not keep showing an old merged PR.
  - The worktree compare (`readBranchPullRequest` in
    `worktree-lifecycle.js`) took whatever
    `gh pr list --head <branch> --state all --limit 1` returned, with
    neither rule.
- **Two wrappers around the GitHub CLI.** `gh()` in the route file and
  `runGhCommand` in `core.js` used different error text, timeouts and
  buffers.
- **A lookup on every call.** Every PR panel action ran `gh repo view`
  again.
- **GitHub's vocabulary in a component.** `checkSummary` in
  `pull-requests/panel.tsx` interpreted GitHub check states (`FAILURE`,
  `TIMED_OUT`, `STALE`...) from the raw `statusCheckRollup` the route
  passed through.
- **No tests.** The routes file (374 lines) had none.

Scope:

- `core.js`: `runGhCommand` is the one `gh` runner. It now has the larger
  buffer, an optional timeout, and the friendlier missing-CLI message.
- New `project-git/pull-requests.js`:
  `createGitHubPullRequests({ gh, git, now })` takes two ports, the `gh`
  CLI and git. It owns:
  - the repository lookup, cached for 30 seconds per folder, with lookups
    under way shared;
  - the one branch-to-PR rule, `branchPullRequest(cwd, branch)`;
  - check summaries: one outcome (unavailable, none, failed, pending,
    passed), the failed count, and each check's name, link and outcome;
  - every route action (`execute`), moved unchanged apart from the above.

  The default instance uses `runGhCommand` and `runGitCommand`.
- `code-pull-request-routes.js` registers the route over that module.
- The worktree compare reads its branch's PR through `branchPullRequest`.
  Its answer keeps its shape (`ProjectGitPullRequest`).
- The PR panel maps a check outcome to its label, icon and colour; it no
  longer knows GitHub's state names.

Excluded (worth doing separately):

- The renderer's PR reads still go through `prRequest`'s own 15-second
  cache and the `dream:code-pr-refresh` window event, beside the
  `pullRequestContext` project resource. Making PR detail and pages
  project resources is the review's "worth exploring" half.
- Comments and files still arrive in GitHub's own shape (`html_url`,
  `user.login`...), which the panel reads directly.
- `createProjectPullRequest` still runs `gh pr create` itself (through the
  same runner).

Completion criteria:

- One `gh` runner; no other `execFile("gh", ...)` in the main process.
- The worktree compare and the PR panel's context answer "which PR is this
  branch's" with the same function.
- Covered by tests with fake `gh` and git ports:
  - an open PR from the exact head repository wins, and a fork's is
    ignored;
  - a closed PR counts only while the branch has no newer work;
  - a branch whose push remote is on another host has none;
  - the repository lookup is shared and cached, and read again after it
    expires;
  - check outcomes, and `detail` carrying the summary;
  - the "repository changed" guard.

Validation (2026-10-16):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 156 files, 1082 passed, 4 skipped.
- `project-git/pull-requests.test.js` has 9 tests over fake `gh` and git
  ports, covering every case in the completion criteria.
- A search finds one `execFile("gh", ...)` in the main process, in
  `runGhCommand`.
- `code-pull-request-routes.js` went from 374 lines to 20.
- Not inspected in the running app (the user's live session), nor against
  GitHub. Worth a check by hand:
  - the PR panel on a branch with an open PR;
  - a long-lived branch whose PR merged;
  - a worktree's compare dialog;
  - a PR whose checks fail.

Behaviour changes, all deliberate:

- The worktree compare finds its branch's PR by the panel's rule:
  - the head must be on the repository the branch pushes to;
  - an open PR wins;
  - a closed or merged one counts only while the branch has no newer work.

  Before, it took `gh pr list --head`'s newest match. It now reads through
  the REST API after the cached repository lookup. It still answers none
  when GitHub cannot say.
- PR panel actions within 30 seconds share one `gh repo view`. After a
  remote's URL changes, the old repository can be used for up to that
  long.
- The missing-CLI message is "Install GitHub CLI (gh) to use pull
  requests." everywhere. The PR panel's API calls keep their 45-second
  timeout and the larger output buffer.
- A PR's `detail` carries `checks` as `{ outcome, failedCount, items }`
  instead of GitHub's raw `statusCheckRollup`.

Recovery: docs/architecture/tasks/github-pull-requests.md#GHPR-01.
