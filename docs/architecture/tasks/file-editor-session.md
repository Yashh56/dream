# File editor session and one way to open a project file

From the October 16 architecture review (candidate 2).

## FES-01: The Files panel's open files live in a session outside React

Status: implemented

Problem and trigger: the Files panel (`FileExplorerPanelImpl` in
`file-explorer-panel.tsx`) held its open files in component state:

- tabs and buffers in `useReducer`
- metadata and preview notices in separate `useState` maps
- one panel-wide loading flag and error
- a load effect, save, close-with-confirm, auto-pin on edit, pending reveals
- reconciliation with the files refresh key

None of it could be tested without rendering.

Observed defects:

- **Drafts lost on remount.** `right-panel-views.tsx` keys the panel on
  whether the SSH host is away, so a dropped host remounts it and unsaved
  drafts disappear.
- **Stale reopen.** Closing a tab kept its buffer, so reopening the file
  showed the old content until the next refresh.
- **Open request replays.** The store's open request
  (`projectFileOpenRequests`) was never consumed. Every time the panel
  became active again it previewed the requested file again, taking the
  active tab back from the user.
- **Absolute paths.** A chat chip passing an absolute path (Claude Code's
  `file_path`) opened a tab the tree could not reveal, and the tree then
  reported it missing, which closed it.
- **Path-only project lookup.** The chips found their project by path alone,
  ignoring the host. The markdown link used the active project rather than
  the chat's.

Scope:

- New `file-editor-session.ts`:
  - `createFileEditorSessions({ api, getProjectPath, onSaved })` returns
    one session per project. Each session owns its tabs, its open files
    (buffer, metadata, load status, read error) and its pending reveal.
  - Actions: open, pin, activate, reorder, edit, close (asks to confirm
    when dirty), save, save-and-close, discard-and-close, reload, a file
    found missing.
  - The container refreshes and drops sessions.
  - Panels subscribe to a session's snapshot.
- `file-tabs.ts` and `file-buffers.ts` become its internals, keyed by path
  within one project.
- New `project-file-path.ts` turns a raw path (absolute inside the project,
  relative, Windows separators) into the project-relative form, or null
  when it is outside the project.
- `openProjectFile(projectId, rawPath, position)` resolves the path once,
  opens it in the project's session and shows the Files view.
  `projectFileOpenRequests` is deleted.
- `ide-store.ts` creates the sessions and follows the store:
  - a files refresh key bump refreshes that session (clean files reload);
  - a project that is no longer open drops its session.
- Chat chips and markdown file links find the chat's project with one
  host-aware lookup (`findProjectForPath`, active project first, as host
  routing already does) and pass raw paths.

Excluded:

- Image previews stay in the panel (an object URL is a view concern).
- The file tree's glue (candidate 4 of the same review).
- Drafts are not persisted across a restart or a project close (unchanged).

Completion criteria:

- The panel holds no file tab, buffer, metadata or load state of its own.
  It renders a session snapshot and calls session actions.
- A draft survives the panel remounting.
- Closing a clean tab forgets the file, so reopening reads disk.
- Opening from chat happens once. Reactivating the panel does not reopen
  it.
- An absolute path inside the project opens as its relative path: one tab,
  never closed as missing. A path outside the project does nothing.
- Pure tests of the session cover each of the above, plus:
  - save success, failure, and conflict (409) followed by reload;
  - a close that needs confirmation, a save-and-close that fails;
  - a refresh that keeps dirty drafts;
  - auto-pin on edit;
  - stale load results ignored.
- Existing tab and buffer reducer tests pass.

Validation (2026-10-16):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 152 files, 1028 passed, 4 skipped.
- `file-editor-session.test.ts` (18 tests, real route client over an
  in-memory disk) covers:
  - reading on open; images never read as text; too large is unavailable
  - drafts outliving any panel; auto-pin on edit
  - closing and replaced previews forgetting the file
  - confirm on close; discard
  - save, conflict then reload, a failing save-and-close
  - refresh keeping drafts; stale reads ignored; reveals; missing files
  - dropping a session; retrying a failed read; subscriber notification
- `panel-actions.test.ts`:
  - an absolute path opens as its relative path in the Files view;
  - two spellings of one file give one tab;
  - outside paths and unknown projects open nothing.
- `project-file-path.test.ts` covers the path resolver.
- The tab and buffer reducer tests pass. They lost their project keying,
  and gained a dirty-check test.
- `file-explorer-panel.tsx` went from 1886 to 1531 lines. The open-request
  map is deleted from the store and the runtime-state registry.
- Not inspected in the running app: the dev session is the user's live
  workspace. Its log shows no renderer errors after the hot reload, which
  is weak evidence. To check by hand:
  - open a file from a Claude Code read chip (absolute path);
  - edit, then switch away and back to the Files view;
  - close a dirty tab;
  - reopen a closed file after changing it on disk.

Behaviour changes, all deliberate:

- A draft survives the Files panel remounting (an SSH host going away and
  coming back).
- Closing a tab, or a preview tab being replaced, forgets the file, so the
  next open reads disk.
- Opening from chat happens once and is never replayed.
- An absolute path inside the project opens as its relative path. A path
  outside it disables the chip's open button.
- A refresh reads the showing clean file again right away, including while
  the Files view is hidden, instead of when the panel next becomes active.
- Showing a file whose read failed retries the read, as the panel's load
  effect did.
- Markdown file links open in the chat's project (found by its folder)
  rather than the active project.

Remaining/deferred: the exclusions above.

Recovery: docs/architecture/tasks/file-editor-session.md#FES-01.
