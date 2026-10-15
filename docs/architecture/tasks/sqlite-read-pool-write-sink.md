# SQLite read pool and write sink

Selected by the user on October 14, 2026: implement the recommendations from
the exploration of SQLite reads and writes (read pools and write sinks).

Baseline, measured on a read-only snapshot of a real `dream.db` (24 projects,
85 chats, 673 messages, 52 MB of payloads, largest message 5.2 MB), Node
24.14 on Apple silicon:

| Operation | Thread blocked |
|---|---|
| Transcript search ("the" / "function") | 349 / 263 ms |
| Largest transcript (8 MB) read + response re-serialize | 27 + 10 ms |
| Catalog list | 0.8 ms |
| Small catalog commit, one transaction each | 0.05–0.14 ms |
| 40-step turn growing to 5 MB, saved at every step | 1.2 s (writer) |

The local host runs inside Electron's main process, and a daemon serves
terminals and the host socket on the same thread as its catalog reads.

## SQL-01: Search reads a derived text table

Status: complete

Problem and trigger: a search LIKE-scanned every JSON payload and parsed the
matches; the prose it actually reads is 525 KB of the 52 MB.

Scope: `chat_message_text` (migration 0003) holds each message's text parts,
joined by U+001F. The save path (`saveChatMessages`) writes it beside each
message; an AFTER DELETE trigger removes it with its message, cascades
included; the migration backfills it with the same rule in SQL. Search
semantics are unchanged: same ordering, row limit, snippets, match counts.

Changed from the exploration: a plain table instead of FTS5 trigram. An FTS5
table is keyed by rowid, which `VACUUM` may renumber on `chat_messages`
(no INTEGER PRIMARY KEY); the plain table measured 1–5 ms, enough. Insert
and update triggers were tried and dropped: deriving text in SQL on every
save more than doubled a 5 MB message's write.

Completion criteria:

- Search reads no payload; results match the previous behavior (existing
  catalog-store search tests).
- The table follows writes, removed messages and removed chats; the SQL
  backfill derives exactly what the save path writes (parity test).

## SQL-02: Catalog reads on a read pool

Status: complete

Scope: `state-read-pool.js` runs two reader threads
(`persisted-state-read-worker.js`), each with its own `query_only`
connection; a read goes to the least busy one. Readers open the file only
after the writer's `ready()` (the save worker opened, created and migrated
it); they never migrate. The host catalog's reads (`list`, `getChat`,
`resolveProjectPath`, `getTranscriptJson`, `search`) go through it; with no
reader (route tests) they run in-thread. Transcripts cross as the stored
JSON text and are sent as the response body without being parsed on the
host thread. Electron main reads theme and install id at startup on a
connection that never migrates; it no longer opens a migrating connection.
`resolvePersistedProjectPath` in the chat route became
`catalog.resolveProjectPath`. The workspace load stays in the write queue
(its ordering after queued writes is deliberate).

Completion criteria:

- The host thread does not run catalog SQL; reads after a settled write see
  it; a failed read is reported and the reader keeps serving; a closed pool
  refuses reads (state-read-pool tests).
- The bundled host runtime ships the reader worker.

## SQL-03: Write sink changes

Status: complete

Scope: the existing save queue stays the one writer. Changes: theme and
install id writes go through it (`saveConfigValue`) instead of the main
thread, with theme preferences cached in main; `ready()` opens the database;
migrations decide what to apply inside `BEGIN IMMEDIATE`, so two connections
opening at once cannot apply one twice; `synchronous = NORMAL` and a 32 MB
`journal_size_limit`. Transcript saves no longer read stored payloads back:
byte lengths come from `octet_length` (no payload load), and only a payload
of equal size is compared, inside SQLite. A running turn saves its steps at
most once a second (`TURN_SAVE_INTERVAL_MS`); a held step is replaced by a
later one or dropped by the end, which is always saved at once and never
followed by a held step.

Not done, measured as not worth it: grouping writes into shared transactions
(a commit costs 0.05–0.14 ms).

## Validation

- `pnpm check` passed: scratch hygiene, Biome, TypeScript, 145 test files
  (972 tests), including new tests for the text table, upgrade backfill
  parity, transcript JSON, the read pool and the turn save interval.
- Same snapshot after the change: search 0.5–4 ms in a reader thread with at
  most 1.5 ms stall on the calling thread; the 8 MB transcript 32 ms in a
  reader with 1.3 ms stall; catalog 1.3 ms. One-time migration with backfill
  304 ms in the writer thread.
- A 40-step 5 MB turn saved at every step: about 5–10% less writer time
  (1.14–1.26 s against 1.19–1.39 s in-thread); the row write and the
  schema's `json_valid` check dominate. The interval is what reduces it for
  turns whose steps arrive quickly.
- The bundled host runtime (`scripts/build-host-runtime.mjs`) was built and
  run as a daemon: catalog changes, transcript save, raw transcript read,
  search and list answered through the pool; `stop` shut it down.
- Windows CI (run 38680071638) timed out in chat-turn-routes cleanup: the
  turn observer's final save, chat read and session change take more
  microtask steps now, and the hook saw no write pending between them, closed
  the database, and the session change reopened it. The hook now waits until
  no write is pending across a turn of the event loop; a probe counting
  writes after close found 1 before the fix and 0 after, over three runs.
- Not run: the Electron app itself (no development server was started).
  Electron main's startup reads, theme caching and install id write are
  covered by inspection only.

Remaining/deferred:

- Storing a message's parts as rows so a step appends instead of rewriting
  the whole message (a schema change); the only fix for a turn's save cost
  growing with its length.
- LIKE folds ASCII case only, as the previous payload scan did.
- Writes made by a build older than this one are not in the text table
  until their message is saved again.

Recovery: docs/architecture/tasks/sqlite-read-pool-write-sink.md, SQL-01 to
SQL-03, complete; remaining items above are proposals, not open work.
