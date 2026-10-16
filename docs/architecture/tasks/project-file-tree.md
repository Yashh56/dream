# The project file tree as one module

From the October 16 architecture review (candidate 4).

## PFT-01: One module connects the directory loader, the path index and the tree model

Status: implemented

Problem and trigger: `ProjectDirectoryLoader` and `ProjectFileSearchIndex`
are tested. The code connecting them to the `@pierre/trees` model lived in
the `ProjectFileTree` component, about 300 lines of effects and refs, with
no tests:

- skipping paths already in the model
- syncing expansion (ignored while search is open)
- injecting search matches on a debounce
- the refresh/reset with its StrictMode workaround
- revealing the selected file, and reporting one that is missing
- resolving a tree selection to a file

The loader's tests reproduced that glue to exercise it ("Mirrors the panel:
skip paths already present"; the expansion sync was pasted twice). The
component also kept `knownFilesRef`, a second copy of the loader's own
`knownFiles`.

Scope:

- New `project-file-tree.ts`: `ProjectFileTree`, a plain class over one
  tree model.
  - **Owns:** the loader, the path index, root status and per-directory
    errors (as a snapshot with `subscribe`).
  - **Model rules:** expansion sync, search injection, reveal, and
    selection resolution. Known files come from the loader alone.
  - **Interface:** `attach` and `detach` (the component's mount),
    `load(version)`, `retry(directory)`, `searchChanged(query)`,
    `reveal(path)` (answering revealed, missing or superseded),
    `deselectOthers(path)`, `selectedFile(current)`.
- The component keeps the React and DOM parts:
  - `useFileTree` for the model's lifetime;
  - the toolbar portal, wheel boost, click and Enter capture, status chrome;
  - calling `onSelectedFileMissing` when a reveal answers missing.
- The loader and index stay as internal seams with their own tests. The
  loader tests that reproduced the panel's glue move to
  `project-file-tree.test.ts`, where they exercise the real module.

Excluded:

- The tree still takes the files refresh key as `refreshVersion`. Moving
  that onto the project resources is separate work.
- The file editor session (FES-01) is untouched.

Completion criteria:

- `ProjectFileTree` (the component) has no loader, index, expansion,
  injection or known-file logic of its own.
- No test reproduces component code. The tests that did now drive
  `ProjectFileTree` (the module) with a real `FileTree` model and fake
  fetches.
- Covered:
  - root loading, empty and error status, and nested errors with retry;
  - expansion loading a directory once, while search open never loads;
  - debounced search injection, plus stale queries and results arriving
    after a refresh ignored;
  - reveal of an injected file loading its directory without a "Path
    already exists" error;
  - missing versus superseded reveals; selection resolution;
  - `load` reloading only on a new version or after `detach`.

Validation (2026-10-16):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 153 files, 1047 passed, 4 skipped.
- `project-file-tree.test.ts` has 14 tests. Each uses a real `FileTree`
  model and fake fetches, and covers every criterion above.
- Four loader tests reproduced the panel's glue or the model batch. They
  are deleted; their cases are now module tests. The loader keeps nine
  tests of its own, the index its tests unchanged.
- The panel no longer refers to the loader, the index, known files,
  expansion sync or path injection. Only `project-file-tree.ts` imports
  the loader and the index.
- `file-explorer-panel.tsx` went from 1531 to 1315 lines. The four
  callback-ref effects became one ref holding the latest props.
- Not inspected in the running app (the user's live session). Worth a
  check by hand:
  - expand folders;
  - filter, then click a match;
  - refresh;
  - open a file from chat, which reveals it in the tree.

Recovery: docs/architecture/tasks/project-file-tree.md#PFT-01.
