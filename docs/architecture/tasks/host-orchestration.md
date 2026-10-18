# Host orchestration

Accepted scope: implement the October 18 comparison with T3 Code V2 in
Dream's existing host/catalog, provider-adapter and transcript-cache owners.
Keep the AI SDK stream contract and single SQLite writer. No Effect migration.

## ORCH-01: Durable submissions and turn recovery

Status: implemented

Problem and trigger: pending submissions live in a renderer map, reject busy
chats, and disappear on restart. Live host turns survive client disconnection
but not host process loss.

Scope: persist ordered submissions, request receipts and lifecycle status in
the host catalog. Dispatch one turn per chat, deduplicate retries, pause the
queue on Stop and restart, and expose cancellation and explicit resume.
Do not automatically retry uncertain provider side effects after process loss.

Completion criteria:

- Busy chats accept multiple follow-ups with their attachments and selection.
- A duplicate request starts no duplicate provider work, including after restart.
- Queues retain order across restart; interrupted work and paused queues are visible.
- Stop prevents automatic dispatch; resume is explicit; cancelled work never runs.
- Host-owned dispatch uses current transcript and session state, independent of clients.
- Lifecycle records distinguish waiting, running and terminal outcomes.
- Local and SSH hosts use the same implementation and writer ordering.

Validation: `run-scheduler.test.js` uses the real writer worker, reader pool,
catalog and turn registry to cover ordered dispatch, receipt deduplication,
interrupted recovery, delayed Stop and explicit resume. Renderer tests cover
busy submissions, preserved attachments, ordered acceptance and retrying a lost
receipt with the same ID. Queue controls and statuses are translated in all
11 locales. Local and daemon hosts construct the same scheduler.

Remaining/deferred: no implementation remaining. Live SSH/provider and visual
smoke tests were not run. Acceptance is durable once the host commits its receipt;
the composer retains its draft until acceptance, and retries an ambiguous receipt
once using the same ID. This does not claim exactly-once provider side effects
across process loss.

## ORCH-02: Native session continuity and forks

Status: implemented

Scope: extend provider capabilities with verified session/fork behavior; use
native operations where supported and retain explicit reconstruction fallbacks.
Retain provider session handles and coverage per chat so switching back cannot
silently resume stale context. Preserve stable branch source boundaries.

Completion criteria:

- Supported model changes preserve native sessions.
- Native forks create independent sessions; unsupported providers reconstruct.
- Switching providers retains canonical history and supplies missed context.
- Adapter tests cover supported behavior and failures for affected providers.

Validation: session-context tests cover model/speed changes, provider return
with missed prose/tool results, edited/relocated/oversized histories and binary
attachment reconstruction. Native-fork tests verify Claude's inclusive native
message UUID and Codex's inclusive completed turn ID, independent identity and
fallback when the returned boundary is unconfirmed. Native replay verifies the
recorded boundary and persisted provider-session coverage together.

Provider contract evidence: installed `ai-sdk-provider-claude-code` 4.3.3
`forkSession` types, and the official Codex
[thread protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/thread.rs).

Remaining/deferred: no implementation remaining. Live forks were not invoked.
Codex reconstructs when a CLI omits or disagrees with the returned turn boundary;
Cursor/Grok reconstruct on model changes. Missing binary context or handoffs
above 32,000 characters use each adapter's full-history reconstruction.

## ORCH-03: Transcript pagination

Status: implemented

Scope: recent-history pages from the host through the transcript cache, with
load-earlier UI. Prompt construction, branching and full-history saves must not
mistake a page for an entire transcript.

Completion criteria:

- Initial UI load is bounded; earlier messages can be loaded without duplicates.
- Sending, branching, refresh and saves preserve history outside the loaded page.
- Cursor boundary and concurrent update tests; representative transfer measurements.

Validation: `transcript-page.test.js` covers append-safe cursors, foreign/stale
cursors, byte-limited complete messages, full reconstruction without duplicates,
and transactional partial saves retaining unseen prefixes and newer tails.
`transcript-cache.test.ts` covers deduplicated loads, prepend races, refresh,
partial saves and a full-history caller racing the initial recent-page request.
Branch/worktree callers explicitly load full history; dispatch reads it on the host.

Measurement: 2,000 messages containing 2,048 text characters each produce
4,231,891 bytes of message JSON; the latest 40 produce 84,661 bytes, about
98% less initial message transfer. Pages default to 40 messages and a soft
1 MiB payload budget (one oversized complete message is still returned).
This measures transfer size, not renderer frame time or total heap.

Remaining/deferred: no implementation remaining. No running renderer was found
by `pnpm inspect:dev --json`; visual scroll validation remains a smoke-test item.

## ORCH-04: Provider protocol replay coverage

Status: implemented

Scope: exercise actual adapters and host persistence using provider transport
fixtures. Retain existing unit tests; avoid mocked orchestration in lifecycle tests.

Completion criteria:

- Cover duplicate submit, process loss, delayed interrupt, child-before-parent
  completion, and expired approvals through production lifecycle paths.
- Provider fixtures preserve protocol ordering and correlation identifiers.

Validation: `codex-replay.test.js` replaces only native JSON-RPC transport,
exercising the production adapter, stream writer, queue, catalog reader/writer
and provider-session store. It covers child-before-root completion, delayed
interrupt confirmation, expired approvals, scoped dynamic tools and final
persistence before completion. Durable duplicate/recovery cases also run in
`run-scheduler.test.js`.

Remaining/deferred: no implementation remaining. Fixtures are synthetic native
protocol frames with correlation IDs, not captures from a live authenticated
provider. Existing adapter suites remain; no live provider invocation is claimed.

## ORCH-05: Cross-provider delegation

Status: implemented

Scope: after ORCH-01/02, expose scoped MCP delegation, status/results and
cancellation through durable child chats. Children cannot exceed parent permissions.

Completion criteria:

- A supported parent can launch work on another installed provider and obtain results.
- Child identity, parent relationship, status and result survive restart.
- Retried requests deduplicate; cancellation and parent Stop reach child work.
- Unsupported providers and permission escalation fail explicitly.

Validation: delegation integration cases use the real writer transaction and
scheduler to verify cross-provider child dispatch, duplicate keys/conflicts,
readiness failures, permission caps, durable status/results across service
recreation, wrong-conversation access, token expiry/restart rejection, and parent
Stop reaching running/queued descendants even after a child is soft-deleted.
Codex replay covers dynamic tool registration, root thread/turn authorization,
native response shape and visible tool output. The MCP endpoint uses the shared
stateless handler with its own scoped bearer token rather than an API token.

Contract evidence: official Codex
[dynamic tool types and backward-compatible normalization](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/dynamic_tools.rs).

Remaining/deferred: no implementation remaining. Codex uses thread-scoped dynamic
tools because its app-server shares process-wide MCP config. Claude/OpenCode/Grok
use per-run MCP tokens. Cursor can execute child tasks but cannot initiate
delegation because its adapter exposes no Dream-managed MCP. The parent supplies
an explicit provider/model and self-contained child prompt; children share project
files. Results are polled with `task_status`, including from later parent turns.
Automatic parent wake-up and isolated child worktrees are separate enhancements.
Limits are four delegation levels and eight outstanding children per parent chat.

## Final validation

`pnpm check`: scratch checks, lint, type checking and all 1,196 tests across
172 files passed. `pnpm vite:build` passed; it emits a large-chunk advisory.
`git diff --check` passed. No dev-server starts, commits or pushes; no live
provider invocations or paid calls were made.

Recovery: docs/architecture/tasks/host-orchestration.md, ORCH-01 through ORCH-05
implemented. All implementation criteria are covered by local regression tests;
live-provider/SSH and visual smoke testing remain unverified as noted above.
