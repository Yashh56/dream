# One commit draft, and one way to name and cache generated git text

From the October 16 architecture review (candidate 6).

## CDG-01: The commit composer is one module; generated git text has one fingerprint

Status: implemented

Problem and trigger: two components each ran their own commit composer:
the Changes tab's commit box (`git-panel/commit-box.tsx`) and the commit
dialog (`git-actions/commit-dialog.tsx`, still used by the worktree
dialog). The box's comment says it works "as the commit dialog was". They
held near line-for-line copies of the same logic:

- the generate effect (cached, or generate, ignored after unmount);
- the auto-generate toggle, `canCommit` and `canCommitPush`;
- the submit that branches between push-with-commit and commit.

Around them, generated git text was keyed three times over:

- `git-commit-message-cache.ts` and `git-pull-request-details-cache.ts`
  were two renderer caches (LRU of 50 plus a shared request), each with
  its own copy of the changes fingerprint.
- The main process had a third cache with a third copy.
- The rule for which changes a commit takes
  (`includeUnstaged ? staged || unstaged : staged`) was written once on
  each side.

The copies have drifted, and two of the drifts are defects:

- **Defect, two models share a message.** The main process's fingerprint
  (`getProjectGitChangesFingerprint`) took `model` from its caller and
  never hashed it.
- **Defect, swallowed errors.** The renderer PR-details cache turned every
  failure into empty details, so the dialog showed blank fields with no
  reason.
- **Dead parameter.** The renderer commit cache accepted a `refreshToken`
  it never used.

Scope:

- New `electron/shared/git-changes.js`, used by renderer and main:
  - `selectCommitChanges(changes, includeUnstaged)`;
  - `gitChangesKey(changes, options)`: a stable text from the sorted
    fields that identify a set of changes and every option given.
- Main: `getProjectGitChangesFingerprint(changes, options)` hashes the
  canonical changes and **every** option it is given, so a new option
  cannot be left out again. `generateProjectGitCommitMessage` uses the
  shared selection.
- Renderer: new `git-generated-text.ts` holds both kinds (commit message,
  PR details) in one LRU, with requests under way shared. Commit messages
  are keyed by the canonical changes and the generation settings. PR
  details are keyed by those plus branch, base and next step and the git
  version, since they read commits the status does not list. Failures are
  passed to the caller, never cached. The two old cache files are deleted.
- Renderer: new `git-actions/commit-draft.ts`, a store per composer:
  - **holds:** message, include-unstaged, auto-generate, generating,
    submitting, error;
  - **does:** generates from the cache when allowed and ignores
    generations the inputs have overtaken; submits commit or commit and
    push through an injected route client;
  - **answers:** `canCommit` and `canCommitPush`.

  `useCommitDraft` wires it to React. The box and the dialog keep only
  their layout and what they do after a submit.
- The PR dialog shows a generation failure, in the server's words.

Excluded:

- The PR dialog's own form (title, description, next step) is not a
  commit draft. Only its generated details move to the shared cache.
- How commits and pushes refresh git state (candidate 9) is unchanged.

Completion criteria:

- No component holds generation effects, `canCommit` rules or the
  commit-versus-push branching; both composers render a `CommitDraft`.
- One selection rule and one canonical-changes function, used by both
  sides. One renderer cache for both kinds.
- The main fingerprint differs for different models, and for any other
  option. Covered by a test.
- Commit draft tests cover:
  - a cached message shown at once, and generation success and failure;
  - a stale generation ignored, a message kept while generation may not
    run, and turning auto-generate off;
  - which submit is sent, a submit failure, and the `canCommit` rules.
- PR details: a failure reaches the caller and is not cached. Covered by
  a cache test.

Validation (2026-10-16):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 155 files, 1073 passed, 4 skipped. New tests:
  - `commit-draft.test.ts`: 11 tests with a fake route client and a
    generator the test controls;
  - `git-generated-text.test.ts`: 5 tests;
  - one fingerprint test in `electron/api/project-git/core.test.js`
    (different models, any option, key order). It fails on the old code,
    which never hashed `model`.
- `commit-box.tsx` went from 324 to 195 lines, `commit-dialog.tsx` from
  350 to 198.
- The host runtime is an esbuild bundle, so `electron/shared/git-changes.js`
  is bundled with `core.js`.
- The old `git-commit-message-cache.ts` and
  `git-pull-request-details-cache.ts` had no importers left and are deleted
  (with the user's go-ahead).
- Cleanup pass, also at the user's request:
  - `getProjectGitCachedDiff` in `core.js` is deleted. It already had no
    caller before this work.
  - These are no longer exported, as only their own modules use them:
    `dropPurgedProjectState`, the loader's `normalizeProjectDirectory` and
    `getProjectFileAncestorDirectories`, and `canonicalGitChanges`.
- Not inspected in the running app (the user's live session). Worth a
  check by hand:
  - a commit message after an agent turn;
  - commit, and commit and push from the Changes tab;
  - the worktree commit dialog;
  - a PR dialog whose generation fails.

Behaviour changes, all deliberate:

- The main process no longer serves one model's cached commit message to
  another.
- The PR dialog says why generated details are missing. Before, the fields
  were left empty without a word.
- The commit box and dialog otherwise behave as before.

Recovery: docs/architecture/tasks/commit-draft-and-generated-git-text.md#CDG-01.
