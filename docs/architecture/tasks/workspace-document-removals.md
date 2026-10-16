# Workspace document owns removals and host-catalog merges

From the October 16 architecture review (candidate 1).

## WSDOC-01: Every project removal goes through the workspace document

Status: implemented

Problem and trigger: five store actions removed projects by filtering
`projects`, `closedProjects` and `chats` by hand instead of going through a
workspace-document operation:

- `forgetClosedProject` (project-lifecycle-actions.ts)
- `purgeWorktreeProject` (worktree-actions.ts)
- `removeSshHost` (host-actions.ts)
- `applyCatalogChanges` (catalog-actions.ts)
- the swap in `adoptHostProjects` (catalog-actions.ts)

`loadHostCatalog` replaces a host's projects the same way.

Only two of these paths dropped Project runtime state. A project the host
removed, or one on a removed SSH host, left its terminal, browser-loading,
refresh-key and chat-keyed maps in the store. The host-catalog paths
enforced the invariant with `decodePersistedState` instead of `settle`, so:

- two functions enforced the invariant;
- default chats made there were never registered as drafts;
- a deliberate "no active project" (the new-tab view) was replaced by the
  first project whenever a catalog event arrived.

`hydrate` registered drafts in the store rather than in the document.

Scope:

- `electron/shared/persisted-state-codec.js` gains `decodeCatalogEntries`.
  It validates and de-duplicates raw projects and chats, without enforcing
  the invariant. `decodePersistedState` is built on it.
- `store/workspace-document.ts` gains these pure operations, each ending in
  `settle`:
  - `removeProjects`
  - `applyCatalogChanges`
  - `loadHostCatalog`
  - `adoptProject`
  - `restore` (hydrate)

  The operations that can remove anything return a `WorkspaceRemoval`: the
  next document plus the ids of every project and chat that left it,
  computed by comparing the document before and after.
- `store/project-runtime-state.ts` gains `applyWorkspaceRemoval`, the one
  store-side step that sets the document and drops the purged state of what
  was removed.
- The store actions keep only their side effects: host connections, catalog
  sync bookkeeping, `persist`, and activating a worktree's parent.

Excluded:

- Stopping the terminal processes of a project removed by its host. Today's
  behaviour, unchanged; the session ids now leave the store.
- Clearing "finished while away" marks, which is still in two actions.
- The draft clear in `setMessagesForChat`, which sits on the streaming hot
  path.

Completion criteria:

- Each of the five actions above, plus `loadHostCatalog` and `hydrate`,
  calls a workspace-document operation, and no action filters
  `projects`/`closedProjects`/`chats` itself.
- Every removal path drops runtime state through `applyWorkspaceRemoval`.
  Covered by tests for a host-removed project and a removed SSH host.
- Catalog operations settle: an open project left without a chat gets a
  default chat registered as its draft. Covered by tests.
- Existing store tests (catalog, host load, worktree, host actions) pass
  with their assertions unchanged. Their fixtures may gain the registered
  runtime maps a real store always has.
- New pure tests sit beside `workspace-document.test.ts` and assert the
  invariant after each new operation.

Validation (2026-10-16):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 148 files, 1001 passed, 4 skipped.
- New pure tests in `workspace-document.test.ts` cover:
  - `removeProjects`, including the no-op case
  - `removeHostProjects`
  - a host removing an open project's last chat, which leaves a fresh draft
  - catalog changes keeping the new-tab view and the workspace fields
  - another host never removing a local project
  - `loadHostCatalog` reporting the host's vanished projects
  - `adoptProject`
  - `restore` drafts
- New store tests: a project removed by its host
  (`catalog-actions.test.ts`) and a removed SSH host
  (`host-actions.test.ts`) leave no runtime maps behind. Both failed with
  the previous implementation, which kept those maps.
- Existing catalog test fixtures gained the registered runtime maps (spread
  from the registry constants, as `worktree-actions.test.ts` already does).
  Their assertions are unchanged.

Behaviour changes, all deliberate:

- Catalog events no longer replace a null active project (the new-tab
  view) with the first project.
- `removeSshHost` follows the same rule.
- Default chats made while settling a catalog are registered as drafts.
- Catalog paths re-decode existing chats but no longer overwrite a chat's
  `messageCount` with its loaded transcript length.
  `setMessagesForChat` and the transcript cache keep that count in sync.
- `sync.forget` also forgets the chats of a removed project, which the host
  removed along with it.

Not inspected in the running app; covered by the store tests above.

Remaining/deferred: the exclusions above. Candidate 3 of the same review
(right-panel navigation) moves chat column close/reorder into this document
next.

Recovery: docs/architecture/tasks/workspace-document-removals.md#WSDOC-01.
