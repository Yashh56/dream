# Project git writes in one store module

From the October 16 architecture review (candidate 9).

## PGW-01: Git writes, their in-flight state and their refresh in one module

Status: implemented

Problem and trigger: every renderer surface that writes to git ran the same
steps itself. Each held its own pending flag, called the route client, and
bumped the project's git refresh key in `finally`. The surfaces:

- the Git panel footer: push, pull and fetch;
- the commit draft: commit, and commit and push;
- the Changes tab: revert;
- the branch switcher: checkout, through `useProjectGitBranches`;
- the create-PR dialog: create a pull request.

Other surfaces bumped the key once more after these writes: the footer
after a PR was created, and the worktree dialog after its commit. Nothing
stopped two writes to one repository running at once: the footer's busy
flag and the commit box's submitting state did not know of each other.
Concurrent git writes race on the index lock.

Separately, deciding whether a summary status can be served from a full one
was written on both sides of the route seam:

- the renderer's `narrowGitStatusToSummary` in `project-resources.ts`;
- the host's `narrowProjectGitStatus` and `summarizeProjectGitChanges` in
  `core.js`.

Scope:

- New `store/git-write-actions.ts`. These actions write git for a project,
  on the project's own host:
  - commit, and commit and push;
  - push, pull and fetch;
  - revert files or everything;
  - checkout;
  - create a pull request.

  Each records one write in flight per project in `gitWriteByProject` (a
  registered runtime map). A second write while one runs is refused, not
  started. Each bumps the project's git refresh key exactly once, after
  the write, whether it succeeded or failed. Each answers an outcome
  (`{ ok, result }` or `{ ok: false, error }`) and never throws; the
  surface decides how to show a failure.
- Callers use the actions and keep only presentation (toasts, inline
  errors) and what follows a write:
  - footer;
  - commit draft (its injected route client becomes an injected commit);
  - Changes tab;
  - branches hook and branch switcher;
  - create-PR dialog;
  - worktree dialog.

  Their own refresh bumps after writes are deleted.
- The footer's busy state and the commit composer read the project's write
  in flight, so they agree.
- `electron/shared/git-changes.js` gains `summarizeGitChanges` and
  `narrowGitStatus(status, detail)`:
  - the host's status read uses them, and its two local copies are
    deleted;
  - the renderer's summary-from-full resource serve uses them, and
    `narrowGitStatusToSummary` is deleted.

Excluded:

- Worktree create, merge and cleanup are already one module
  (`worktree-actions.ts`) with their own flow.
- The Git panel's bump when it is shown or refreshed is a read, not a
  write.
- `getGitNextStep` and the "can do X" checks in the footer.

Completion criteria:

- No component or hook calls a git write route, or bumps the refresh key
  after one.
- One write in flight per project, refused (not queued) otherwise; the
  refresh key moves once per write, success or failure.
- One narrowing function, used by both sides.
- Covered by store tests with the fake route client:
  - each action sends the right request to the project's host;
  - busy refusal;
  - exactly one bump per write, success and failure;
  - outcomes carry the result or the error;
  - the in-flight record clears.
- Existing commit draft, Changes and status tests pass, with fixtures
  adapted to the injected commit.

Validation (2026-10-17):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 157 files, 1088 passed, 4 skipped.
- `store/git-write-actions.test.ts` has 7 tests:
  - one each for commit, commit and push, revert (file and all);
  - a failure answered and still refreshed once;
  - one write per project, with a refused second write that moves nothing
    while another project's write runs;
  - every write on its project's host (through a recording transport);
  - an unknown project not written to.
- The commit draft tests now inject a commit instead of a route client;
  their assertions on what is sent are unchanged in substance.
- A search finds no git write route called outside the module.
- Every remaining `bumpProjectGitRefreshKey` is one of:
  - a read (the Git panel shown or refreshed; since 2026-10-25 also
    another Git tab shown, returning to the window for the project in
    front (`window-return.ts`), and a command entered in the project's
    terminal once its output goes quiet (`terminal-command-refresh.ts`).
    The Log tab no longer has a refresh button);
  - a file save;
  - an agent turn;
  - a host reconnect;
  - the excluded worktree flows (including forgetting a worktree in the
    projects panel).
- `core.js` and `project-resources.ts` both narrow statuses through
  `narrowGitStatus` in `electron/shared/git-changes.js`.
- `electron/api/checkpoints/service.test.js` failed once under the full
  suite: 3 or 4 tests, the file taking 35 seconds. It then passed in five
  runs on its own and in a second full-suite run.
  - It does not touch the changed code (it imports only
    `parseSingleFileDiff` from `core.js`).
  - It looks like git subprocesses timing out under load. Recorded here as
    a pre-existing flake to look into, not fixed.
- Not inspected in the running app (the user's live session). Worth a
  check by hand:
  - push, pull and fetch from the footer;
  - start a push, then look at the Changes tab: its commit buttons are
    disabled until the push ends;
  - revert;
  - switching branch;
  - creating a PR.

Behaviour changes, all deliberate:

- A project runs one git write at a time. A write asked for while another
  runs is refused, with "Another git action is still running for this
  project." The surfaces disable their controls while a write runs, so
  this is rarely seen. Before, the footer and the commit box could run
  writes at the same time.
- Git writes go to the project's host explicitly. Before, only checkout
  did; the others resolved the host from the project path.
- The footer's busy spinner and disabled actions follow any write of the
  project, including a commit from the Changes tab. The commit box and
  dialog wait (buttons disabled, Enter ignored) while another write of
  their project runs, such as a push from the footer.
- One refresh per write. Before, PR creation and the worktree dialog's
  commit refreshed once more after the dialog closed.

Recovery: docs/architecture/tasks/project-git-writes.md#PGW-01.
