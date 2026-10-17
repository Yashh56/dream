# Model selection settled by a pure function

From the October 16 architecture review (candidate 11).

## MSS-01: Settle models in actions, from the provider rows

Status: implemented

Problem and trigger: keeping every project's and chat's model valid was a
150-line `useEffect` in `ide-shell.tsx`, run on every settings change, with
no tests. It:

- deduplicated each provider's picked models, naming all five settings;
- repaired the default model;
- moved projects through `setProjects`;
- moved chats with a raw `useIdeStore.setState`.

The provider list was written out by hand in many places:

- `model-selection.js`: `ALL_PROVIDERS`, `normalizeProvider`,
  `getModelsForProvider`, and the Claude Code alias rule in
  `getProviderForModel`;
- the codec: decoding each picked-models setting, the default settings,
  and the model id rule in two places;
- `provider-model-state.ts`: six functions, one block per provider;
- the `providerModels` and `ProviderModelsResponse` types.

That contradicts the glossary's "adding a provider is one row and one
record". The chat panel's `modelId` had no `grok` branch, so a Grok model
was priced as `openai:<model>`.

Scope:

- Each provider capability row gains:
  - `selectedModelsSetting`: the setting holding its picked models;
  - `modelAliases`: `"claude-code"` or `null`, how its model ids are
    spelt.
- `model-selection.js` reads the rows and names no provider:
  - `ALL_PROVIDERS` is `PROVIDER_IDS`;
  - new helpers `normalizeModelIdFor`, `getSelectedModels`,
    `withSelectedModels` and `decodeSelectedModels`;
  - `getModelsForProvider` and `getProviderForModel` use them.
- `getDefaultModelForProvider` moves there from `src/lib/ide-defaults.ts`.
  It is still re-exported from `ide-defaults.ts`.
- New pure `settleModelSelection({ settings, projects, chats })`:
  - picked models normalized, and the defaults repaired;
  - every open project and its chats moved off a provider that offers
    nothing, or off a model no longer offered (the effect's rules,
    unchanged);
  - anything unchanged is answered as the same object.
- `settleSettings(state, settings)` in `settings-actions.ts` applies it to
  the store. Every settings write goes through it:
  - `setSettings` (which SSH host edits use);
  - `toggleProviderModel`;
  - the reconcile after a model fetch;
  - hydration;
  - removing an SSH host.
- The shell's effect is deleted, and with it the shell's subscription to
  `settings`.
- The codec decodes picked models with `decodeSelectedModels`, builds the
  default settings' lists from it, and spells model ids with
  `normalizeModelIdFor`.
- `provider-model-state.ts` loops over the providers. Only how a
  provider's listed models are shown (Codex's hidden models filtered,
  Cursor's sorted) is per provider, in one small map.
  `areSettingsSelectionsEqual` becomes the shared `areModelSettingsEqual`.
- `providerModels` and `ProviderModelsResponse` are typed from
  `AiProvider`, and `SelectedModelsSetting` from `AppSettings`.
- `chat-panel.tsx`'s `modelId` is `${provider}:${model}`.

Excluded:

- The `AiProvider` union and each provider's `…SelectedModels` field in
  `AppSettings`. Renaming the stored keys would need a migration, so a new
  provider still declares both.
- Model option rules (`model-options.js`) and the main process's model
  fetchers.

Completion criteria:

- No effect repairs models.
- Outside the rows, no renderer or shared module names a provider to find
  its picked models or spell its model ids.
- Table tests per provider:
  - picked-model helpers;
  - connection and disabling;
  - settling a stale model and a disabled provider;
  - the store's provider model state (toggle, loading, failure, fetch
    result, reconcile).
- Store tests that writing settings settles projects and chats.
- The chat panel prices a Grok model as `grok:<model>`.

Validation (2026-10-17):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `pnpm test`: 160 files, 1139 passed, 4 skipped.
- New `electron/shared/model-selection.test.js` has 23 tests:
  - 4 per provider: its setting, connection and disabling, a stale model
    moving to its fallback, a disabled provider's project and chat moving
    to the default;
  - 3 more: normalizing picks and defaults, identity when nothing moves,
    and chats of projects that are not open left alone.
- New `store/provider-model-state.test.ts` has 21 tests:
  - 4 per provider: toggle, loading and failure touching only it, a fetch
    result replacing only its listing, and pruning only on an
    authoritative listing;
  - 1 for the empty starting state.
- New `store/settings-actions.test.ts` has 3 tests, through the real
  actions:
  - unpicking a model moves the project and chat on it;
  - disabling a provider moves them to the default;
  - an unrelated settings change keeps them as the same objects.

  The old `setSettings` did not touch projects or chats, so the first two
  hold only with the settle in the action. They were not run against the
  old code: its provider state module no longer exists in that shape.
- `registry.test.js` lists the two new row fields in its complete-record
  check, because the registry spreads the row.
- Not inspected in the running app. Worth a check by hand:
  - unpick the model a chat uses in settings: the chat's picker moves to
    the fallback;
  - disable a provider: its chats move to the default model.

Behaviour changes:

- Models are settled in the same store update as the settings change.
  Before, they were settled one render later, by the effect.
- Removing an SSH host now also settles models. That is harmless: the
  host list offers no models.
- Picked Claude Code models are normalized when a model is toggled, not
  just afterwards by the effect. The result is the same.
- A Grok chat's context popover prices its model as `grok:<model>`
  instead of `openai:<model>`. tokenlens lists no Grok models, so it shows
  no cost either way; before, a Grok id that matched an OpenAI one would
  have been priced as OpenAI.

Recovery: docs/architecture/tasks/model-selection-settle.md#MSS-01.
