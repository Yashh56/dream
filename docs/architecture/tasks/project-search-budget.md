# Project search work budget

## PDRY-03: Put the Project search work budget inside the scan

Status: complete

Selected by the user: implement candidate #3 from the October 11, 2026
performance and DRY architecture review.

Problem and trigger: Project text search scans every line and materializes
every matching range in 16 files before the collector applies its result limit.
Cancellation is checked only around the walk and batches, and whole-line counts
can exceed the requested maximum.

Scope: the Project search module owns one match budget across ordered matching,
collection and read scheduling. Keep the existing filesystem adapter, traversal,
route response shape, query options and preview positions.

Decisions:

- `maxResults` counts individual non-empty matches, including within one line.
  The last line may contain only its first remaining matches.
- One additional match establishes `truncated`; an exact-limit complete result
  stays untruncated. Looking for that extra match may still scan later files.
- Keep up to 16 concurrent file reads, but scan their text in traversal order.
  Once the extra match is found, stop matching/scheduling and abort pending reads.
- Iterate lines lazily and yield periodically during matching (including empty
  regex matches) so the event loop can deliver cancellation. A single synchronous
  regex evaluation is not preemptible; worker-enforced deadlines are out of scope.

Completion criteria:

- Dense lines and files never produce more retained matches than the shared
  budget; files later in a batch are not scanned after truncation is established.
- Keep deterministic file/line ordering, exact match counts and preview offsets,
  literal/regex/case/whole-word behavior, and binary/size/include/exclude filtering.
- Stop and clean up reads on abort or truncation, without unhandled rejections;
  genuine read errors still reach the route while disappeared/unreadable files
  retain their current skip behavior.
- Existing synchronous matching helpers and host search share the implementation.
- Run existing checks; write no tests and start no development server.

Implementation:

- Shared generators iterate non-empty matches and lines without splitting the
  whole file or building its complete result set. Synchronous matching helpers
  consume the same implementation as the host search.
- One budget spans every scanned file. Only retained matches decrement it;
  the first additional match proves truncation and ends matching. Dense-line
  previews contain only retained matches, with the existing offset calculation.
- Reads are prefetched in batches of up to 16 and consumed in traversal order.
  Matching no longer waits for the entire batch or scans every file in it.
- Matching yields to the event loop every 256 regex steps or lines, including
  empty matches and lines with no matches. Cancellation returns already collected
  results, including a partially scanned matching line.
- File reads receive the composed caller/internal abort signal. A finally block
  aborts and drains the pending batch. Read rejections are handled when scheduled;
  errors encountered before stopping still propagate through the existing route.
- Kept the literal-query whole-file rejection, regex line anchors, file filters,
  preview formatting and editor positions. Documented individual-match limits
  in the request schema, response types and glossary.

Validation:

- `pnpm check` passed: scratch hygiene, Biome (643 files), TypeScript, and 143
  existing test files (950 passed, 7 skipped).
- Existing search checks cover literal/regex/case/whole-word behavior, empty
  regex matches, line anchors, preview positions, file eligibility, query filters
  and the existing result-limit example.
- Source review covered dense-line caps, exact-limit versus excess-match results,
  partial-line cancellation, ordered batch consumption and read cleanup. The
  existing suite does not directly cover these new budget/cancellation cases;
  no tests were written. No development server was started.
- No end-to-end latency or memory benchmark was run. At an exact limit with no
  further match, truthful truncation detection can still scan the remaining
  eligible files. One regex execution remains synchronous and uninterruptible.

Remaining/deferred: no implementation remains. Hard regex deadlines, workers,
file-content indexing and filesystem watchers are outside this task. Direct
automated coverage of the new budget/cancellation cases remains absent; new
tests require a user request.

Recovery: docs/architecture/tasks/project-search-budget.md, PDRY-03,
complete; validation above. PDRY-01 and PDRY-02 are committed in 09cb4f7 and
86a58d1. This task's changes are uncommitted; commit and push require confirmation.
