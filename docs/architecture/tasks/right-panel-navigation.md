# Right-panel navigation as store operations

From the October 16 architecture review (candidate 3).

## RPN-01: One set of operations decides what the right panel shows

Status: implemented

Problem and trigger: about seven call sites wrote out their own version of
"show view X":

- `code-workspace.tsx`: the rail, shortcuts, the Git tabs and the terminal
  toggle
- `show-git-panel.ts`
- the terminal's web links (`terminal-panel.tsx`)
- the browser agent's show-browser command (`use-browser-agent-commands.ts`)
- closing the last browser tab (`browser-panel.tsx`)
- `openProjectFile` and `openProjectFileSearch`

They disagreed:

- **Shells left behind.** Leaving the terminal view discards terminals the
  user never typed into, but only some callers did that. Opening a file,
  find in files, and the browser agent switched views and left untouched
  shells running.
- **Stale view written back.** `code-workspace.tsx` kept a local copy of
  the view and persisted it on a 250 ms timer. A chat chip opening a file
  inside that window was overwritten by the older view.
- **Dead state.** `projectTerminalPanelOpenByProject` was written in six
  places and never read. `togglePanel` had no callers.
- **Chat columns skipped the invariant.** Closing, reordering and resizing
  them edited `openChatIds` and `activeChatId` through `updateProject`,
  never `settle`. The neighbour-on-close rule repeated `deleteChat`'s.

Scope:

- `store/panel-actions.ts` gains the right-panel navigation:
  - `showRightPanelView(projectId, view, { toggle?, gitTab? })`
  - `closeRightPanel(projectId)`
  - `toggleRightPanel(projectId)`

  They own three rules:
  - leaving the terminal view discards untouched terminals;
  - showing the terminal view starts a terminal when there is none;
  - a Git tab that is already showing toggles the panel closed.

  The old setters are removed: `setProjectRightPanelOpen`,
  `setProjectRightPanelView`, `setProjectTerminalPanelOpen` and
  `togglePanel`. Every caller above uses the new operations.
- `code-workspace.tsx` reads the view from the project, with no local copy
  or timer. Whether the panel is expanded stays local, as it is purely a
  view of the open panel.
- `store/workspace-document.ts` gains `closeChatColumn`,
  `reorderChatColumns` and `setChatColumnWidths`, each ending in `settle`.
  Closing a column shares its neighbour rule with `deleteChat`. The store
  exposes them as chat actions.
- `projectTerminalPanelOpenByProject` is deleted.

Excluded:

- `closeProjectTerminal` closing the panel after the last terminal is
  terminal behaviour and stays where it is.
- A worktree project created on the Git view is creation, not navigation.

Risk: the view was debounced in May ("Reduce right panel switch latency"),
before saves moved off the main thread. Opening the panel has always
written the store at once; switching views now does too.

Completion criteria:

- No component or action other than the navigation operations writes
  `rightPanelOpen` or `rightPanelView`, apart from project creation and
  `closeProjectTerminal`.
- Every way of leaving the terminal view (another view, closing,
  toggling) discards untouched terminals. Covered by store tests.
- Showing an already-visible view with `toggle` closes the panel. The Git
  tab toggle is covered by tests.
- Chat column close, reorder and resize keep the workspace invariant.
  Covered by pure tests.

Validation (2026-10-16):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 152 files, 1037 passed, 4 skipped.
- `panel-actions.test.ts` covers:
  - every way of leaving the terminal view discarding untouched terminals:
    another view, closing, toggling the panel, toggling the terminal,
    opening a file, find in files;
  - switching between other views discarding nothing;
  - showing the terminal starting one;
  - toggle versus show, and reopening on the last view;
  - the Git tab toggle.
- `workspace-document.test.ts` covers closing the active column (focus to
  its neighbour, the chat kept), the last column not closing, reordering,
  and widths kept only for open chats, each asserting the invariant.
- A search for writes of `rightPanelOpen` or `rightPanelView` finds only
  the navigation operations, `closeProjectTerminal` and worktree creation.
- `code-workspace.tsx` went from 800 to 630 lines.
- Not inspected in the running app (the user's live session). The latency
  risk above is unmeasured. If a view switch feels slow, debounce the
  persisted write inside `setRightPanel`; callers stay as they are.

Behaviour changes, all deliberate:

- Opening a file, find in files and the browser agent now discard untouched
  terminals when they leave the terminal view, as the rail, the shortcuts,
  `useShowGitPanel` and terminal web links already did.
- A view switch is written to the project at once (no 250 ms timer), so a
  later open from a chat chip can no longer be overwritten by an earlier
  click.
- Opening the panel with the toggle shortcut on the terminal view starts a
  terminal right away, rather than through the workspace's effect.

Recovery: docs/architecture/tasks/right-panel-navigation.md#RPN-01.
