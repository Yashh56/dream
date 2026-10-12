# Transcript cache ownership

## PDRY-01: Give the Chat transcript cache every load path

Status: complete

Selected by the user: implement candidate #1 from the October 11, 2026
performance and DRY architecture review.

Problem and trigger: host transcript notifications load messages outside the
transcript cache's request coordination. Changed results are observed as unsaved
and remain protected from eviction even when they match the host's saved data.

Scope: the existing transcript cache owns ordinary loads and catalog refreshes,
including request identity, coalescing, freshness, saved-state provenance and
eviction. Keep the existing store action names, persistence adapter, history
merge rules, streaming ownership, soft limits and renderer finish saves.

Completion criteria:

- Ordinary loads and catalog notifications use one per-chat load coordinator.
- Overlapping notifications coalesce; a notification during a read causes a
  subsequent read rather than accepting the older snapshot as current.
- Abandoned requests cannot install messages or clear a newer request after a
  chat closes without a protected consumer, is deleted, is evicted or begins
  streaming locally.
- Unloaded chats stay lazy unless their initial load is already in progress.
- Refreshed messages are evictable only when the retained history matches the
  persisted snapshot. Merged local answers remain protected when they differ.
- Preserve history merge behavior and reject results overtaken by local edits.
- Failed refreshes keep current messages and allow later notifications to retry;
  initial-load errors still reach callers.
- Run the existing checks; write no tests and start no development server.

Implementation:

- Moved `applyCatalogTranscript` from catalog actions into the transcript cache;
  the host catalog watcher and callers retain their existing store interface.
- Both acquisition paths use one pending request per chat. Notifications during
  a read mark it for a trailing read; superseded snapshots are discarded. A
  newer notification still gets its read after an earlier request fails.
- Request identity is invalidated on abandonment and local streaming. Completion
  also checks transcript identity so local changes during a read take precedence.
  Request ownership ends before publishing, allowing reentrant notifications to
  start a fresh read without being cleared by the earlier request's cleanup.
- Initial loads retain their existing hydration behavior. Refreshes retain the
  existing history/answer merge, then compare the actual retained messages with
  the host snapshot to decide whether eviction is safe.
- Documented the Chat transcript cache in GLOSSARY.md.

Validation:

- `pnpm check` passed: scratch hygiene, Biome (643 files), TypeScript, and 143
  existing test files (950 passed, 7 skipped).
- `git diff --check` passed.
- Source inspection confirms the transcript cache is now the only store caller
  of `loadPersistedChatMessages`, and the host watcher still uses its existing
  action. Reviewed notification coalescing, initial-load invalidation, failed
  reads, local edits, close/delete/stream invalidation and saved-state comparison.
- Existing checks cover surrounding catalog, history merge, answer preservation
  and chat runtime behavior. They do not directly exercise cache refresh races
  or eviction; those cases have source-review evidence only. No new tests or
  development servers were created. No end-to-end speedup or heap reduction was
  measured.

Remaining/deferred: no implementation remains. Removing renderer finish saves,
changing host writes, and the other two review candidates are out of scope.
Direct automated refresh-race and eviction coverage remains absent; adding tests
requires a separate user request.

Recovery: docs/architecture/tasks/transcript-cache-ownership.md, PDRY-01,
complete; validation above. Existing package.json and pnpm-lock.yaml edits were
preserved. Changes are uncommitted; commit and push require confirmation.
