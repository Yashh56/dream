# Persisted fields declared once

From the October 16 architecture review (candidate 10).

## PFO-01: One table for plain persisted fields; one project UI list

Status: implemented

Problem and trigger: the glossary says "a persisted field is added there,
once", meaning in the codec. A plain top-level field like `chatSort` was in
fact named in about 13 places across 6 files:

- the codec: empty state, decode, encode, `stateToConfig`,
  `stateFromConfig`;
- `SAVE_SLICE_FIELDS` in the save scheduler;
- the store: initial state, hydration, and the destructure and encode in
  `saveSlices`;
- two type declarations and the field's setter.

Within the codec, `normalizeProjectUi` (decoding) and `encodeProjectUi`
(saving) listed the same 11 project UI fields twice. Their booleans were
spelt differently but meant the same. Stash items were normalized on load
and stored raw on save.

Scope:

- Codec: `PLAIN_PERSISTED_FIELDS` maps each plain top-level field (one
  `config` row, independent of other fields) to its decoder. A decoder
  given nothing answers the field's default. `decodePlainPersistedFields`
  and `PLAIN_PERSISTED_FIELD_NAMES` derive from it, and so do:
  - the empty state;
  - decode and encode;
  - `stateToConfig` and `stateFromConfig`;
  - the store's initial state, hydration and save;
  - the save scheduler's config slice.
- Fields whose value depends on other fields keep their own handling:
  `activeProjectId` (an open project), and browser tabs and the active tab
  (known projects and tabs).
- `encodeProjectUi` is deleted; saving a project's UI uses
  `normalizeProjectUi`. Stash items are now stored normalized, which is
  what loading made of them anyway.

Excluded:

- Settings, which already round-trip as `settings.<name>` rows without
  per-field code.
- The TypeScript declarations of each field (`PersistedIdeState`,
  `IdeState`). They stay, and type-check the table's decoders.

Completion criteria:

- Adding a plain persisted field means:
  - a row in `PLAIN_PERSISTED_FIELDS`;
  - its type in `PersistedIdeState` and `IdeState`;
  - its setter.

  No other file names it.
- One project UI list.
- A table-driven test: every plain field round-trips through the empty
  state, decode, encode and config, and decodes to its default from
  nothing or junk.
- Existing persisted-state, workspace-save and codec tests pass unchanged.

Validation (2026-10-17):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 157 files, 1092 passed, 4 skipped.
- `persisted-state-codec.test.js` gains 4 tests:
  - every field in the table has a sample in the test, so a new field
    fails until it is given one;
  - every field defaults from the empty state, from nothing, and from junk;
  - every sample survives decode, encode and the `config` rows;
  - a project's stored UI is its decoded UI, with stash items normalized.
- The decoders are type-checked against `PersistedIdeState` through
  `@satisfies`.
- Outside the codec, a search for `chatSort` finds only:
  - its two type declarations;
  - its setter.
- Not inspected in the running app. Worth a check by hand: change the chat
  sort, restart, and see it kept.

Behaviour changes:

- A project's stash items are stored normalized (invalid and duplicate
  items dropped). Before, they were stored as the store held them, and the
  same normalization ran when they were loaded. What the app shows does not
  change.

Recovery: docs/architecture/tasks/persisted-fields-once.md#PFO-01.
