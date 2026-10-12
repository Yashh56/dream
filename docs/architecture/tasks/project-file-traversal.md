# Project file traversal

## PDRY-02: Concentrate recursive Project file traversal

Status: complete

Selected by the user: implement candidate #2 from the October 11, 2026
performance and DRY architecture review.

Problem and trigger: recursive file lists use a second walker that reads only
the root ignore file and includes non-directory entries, while text search uses
nested ignore scopes and regular files only. Sorting, pruning and recursion are
duplicated, and file-name search and Composer mentions see different eligible
paths from text search.

Scope: deepen `walkProjectFiles` in `electron/api/project-git/files.js` to own
recursive traversal for both the limited file list and Project text search.
Use its existing nested-ignore policy, blocked-directory pruning, regular-file
eligibility and name ordering. Retain the concrete filesystem adapter and the
existing route response shapes and resource cache.

Completion criteria:

- Delete the old `walkFiles` and root-only ignore loader; both recursive callers
  use the same traversal implementation.
- File lists adopt text search's nested ignore scopes and omit symlink entries.
- A selected subtree retains project-relative paths and ancestor ignore scopes,
  prunes unrelated sibling subtrees, and cannot enter a symlink directory.
- Listing stops at its result limit without materializing the full walk.
- Both recursive routes pass request cancellation into the shared walker.
- Preserve search-specific include/exclude, text/binary/size filtering and result
  limits; these belong to text search, not file eligibility.
- Keep `listProjectDirectory` unfiltered, including ignored entries and visible
  symlinks, with its existing path validation.
- Run existing checks; add no tests and start no development server.

Implementation:

- Removed `walkFiles` and `loadProjectIgnore`. The limited list consumes
  `walkProjectFiles` and stops the generator immediately at its result limit.
- Added a selected-directory option to the shared traversal. The existing real
  directory resolver validates it; the walk visits only its ancestor chain and
  descendants, retaining scoped ignore rules and project-relative paths.
- The file-list route forwards its request signal, matching text search. Both
  callers now share cancellation, sorting, pruning and regular-file eligibility.
- Ignore-file reads and directory reads use the same handling for directories
  removed or inaccessible during traversal. Search-specific matching and the
  unfiltered immediate-directory listing remain unchanged.
- Added the Project file traversal term to GLOSSARY.md and linked this task
  from the architecture index.

Validation:

- `pnpm check` passed: scratch hygiene, Biome (643 files), TypeScript, and 143
  existing test files (950 passed, 7 skipped).
- `git diff --check` passed.
- Existing search checks exercise nested ignores, blocked/binary/oversized files,
  include/exclude filters and result limits through the shared walker. Existing
  directory checks cover the deliberately unfiltered browser behavior.
- Source review confirms one recursive implementation, subtree/ancestor filtering,
  immediate termination at the file-list limit, and cancellation forwarding.
  Existing checks do not directly cover the new subtree-listing path or listing
  cancellation; these received code review only. Windows-specific skipped
  symlink checks were not replaced with new tests.
- No tests were written, no development server was started, and no performance
  benchmark was run. Reduced traversal depends on actual ignored subtrees.

Remaining/deferred: no implementation remains. Full Git ignore emulation,
shared in-flight host walks, filesystem watchers and candidate #3's search work
budget are outside this change. Direct automated coverage of subtree listing
and listing cancellation remains absent; new tests require a user request.

Recovery: docs/architecture/tasks/project-file-traversal.md, PDRY-02,
complete; validation above. PDRY-01 is already committed in 09cb4f7. This task's
changes are uncommitted; commit and push require confirmation.
