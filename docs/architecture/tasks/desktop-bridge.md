# A testable desktop bridge

From the October 16 architecture review (candidate 12).

## DSK-01: Channel table, injected handlers, and three modules out of main

Status: implemented

Problem and trigger: `electron/main.js` (1145 lines) mixed these
responsibilities:

- app identity and paths;
- the theme preference cache;
- SSH IPC and its prompt broker;
- the renderer-unload guard;
- screenshot state;
- clipboard, shell, file and notification handlers;
- port selection;
- window creation;
- quit ordering.

Every handler was an `ipcMain` callback closing over `mainWindow`, so none
could be tested.

A desktop method was written in three or four places, with its channel
string repeated in each:

- `preload.js`;
- the `DesktopApi` type;
- the handler in `main.js`;
- for some methods, the fixture bridge.

Theme knowledge (valid values, defaults, how a theme shows) was written
four times:

- `main.js`;
- `preload.js`;
- `lib/ui-store.ts`;
- `theme-provider.tsx`.

Scope:

- `electron/shared/desktop-channels.js`: `DESKTOP_METHODS` maps each desktop
  method to its channel, its kind (invoke, send or subscribe) and how its
  arguments travel. `createDesktopMethods(transport)` builds the methods
  from the table:
  - `preload.js` builds `window.dream` with it over `ipcRenderer`;
  - `src/dev/fixture-bridge.ts` builds the same object over a fake
    transport.
- A type-level check in `src/lib/electron.ts`: `DesktopApi` and the table
  name the same methods, or the code does not compile.
- `electron/desktop-handlers.js`: `createDesktopHandlers(deps)` returns
  plain handler functions of the call's payload. The Electron parts,
  window, theme store, save queue, SSH hosts, browser sessions and editors
  are passed in. `registerDesktopHandlers(ipcMain, handlers)` puts each
  handler on its table channel. The updater and the browser agent bridge
  still register their own handlers, now on the table's channels, as do
  the browser sessions' sends.
- Three modules come out of `main.js`:
  - `electron/ssh/prompt-broker.js`: ssh's questions asked in the window,
    with ids, answers and a timeout;
  - `electron/renderer-unload-guard.js`: processes stop before a reload or
    a held navigation, one stop and one reload at a time, plus the reload
    shortcut rule;
  - `electron/theme-store.js`: the saved theme preferences, read once and
    saved on change.

  The renderer half of the unload guard moves from the shell's effect to
  `src/components/ide/renderer-unload-guard.ts`.
- `electron/shared/theme-preferences.js` holds the theme rules: the lists,
  defaults, validation, resolving `system`, the window background, and
  applying to the document. `main.js` (through the theme store), the
  preload, `ui-store.ts` and `theme-provider.tsx` use it.
- `main.js` keeps the wiring: app identity, the renderer server, window
  creation and its events, the menu, and quit ordering. It is now 709
  lines.

Excluded:

- `index.html`'s inline boot script, which must run before any module
  loads. It keeps its own copy of the theme defaults, as the shared
  module's header says.
- Window creation, the renderer server and quit ordering. They are wiring
  and stay in `main.js`.
- `updater.js` and `browser-agent-bridge.js`, apart from their channel
  names.

Completion criteria:

- No IPC channel string outside `desktop-channels.js`, except the two
  synchronous preload reads, which are named in the same module.
- A new desktop method is a table row, its `DesktopApi` signature, and its
  handler. The compiler and the registration test catch a mismatch.
- The handlers, broker, guard and theme store are tested without
  Electron.
- The preload is tested against the old preload's calls.

Validation (2026-10-17):

- `pnpm lint`, `pnpm check:scratch` and `tsc --noEmit` pass.
- `node --check` passes on `main.js`, `preload.js`, `updater.js` and the
  two browser modules.
- `electron/` is excluded from `tsconfig.json`. The new main-process
  modules and the preload were checked once by hand
  (`tsc --ignoreConfig --checkJs --strict` on those files) with no errors
  in them.
- `pnpm test`: 166 files, 1167 passed, 4 skipped (twice).
- One run of the `electron/` tests (with the renderer guard test) reported
  one failed test, and its name was not captured. It did not recur in two
  more `electron/` runs or the second full run. It may be the checkpoint
  service flake recorded in PGW-01, but that is not confirmed.
- `electron/preload.test.js` (4 tests) loads the real preload with
  `electron` mocked:
  - every method sends exactly what the old hand-written preload sent;
  - every subscription listens on its channel and unsubscribes;
  - the method list is complete;
  - the saved theme is on the document before the page runs.

  Run against the old preload (from `HEAD`), all of it passes except the
  method list, which differs by the two removed subscriptions (below).
- `electron/desktop-handlers.test.js` (10 tests):
  - input checks for links, paths, clipboard, files and SSH calls;
  - only saved screenshots shown in a folder;
  - a notification click restoring the window and opening its chat;
  - window controls with and without a window;
  - theme changes saving and repainting;
  - registration covering every method the renderer calls exactly once
    (with the updater's and the browser bridge's), each on its channel;
  - channels unique.
- More tests:
  - `ssh/prompt-broker.test.js` (3): ids, answers, declines, late
    answers, no window, timeout;
  - `renderer-unload-guard.test.js` (5): one reload at a time after the
    stop, no reload of a destroyed page, navigation held only while
    processes run, failed stops reported and retried, reload shortcuts;
  - `theme-store.test.js` (4): the theme rules and the store;
  - `renderer-unload-guard.test.ts` (2): the renderer half.
- The `DesktopApi` check was shown to fail with a table row removed.
- Not run in the app: the change touches the preload and the main
  process's startup, and the user's running session was not restarted.
  Worth a check by hand on the next start:
  - the app starts with the saved theme (no flash);
  - change theme, base and accent color, then reload;
  - Ctrl+R with a terminal running;
  - copy a screenshot, save one, and "Show in folder";
  - a notification click;
  - an SSH host password prompt;
  - window controls on Windows.

Behaviour changes:

- `onBrowserPageState` and `onBrowserStatus` are removed from
  `window.dream` and `DesktopApi`, with their event types. The main
  process never sent on those channels and nothing subscribed.
- The main process validates the saved base and accent colors on read: an
  unknown stored value reads as the default. Before, only the theme was
  validated. A change with an invalid value now keeps the current one;
  before, an invalid theme became `dark` and an invalid color was saved
  as given. The renderer only sends valid values.
- The fixture bridge throws when an unsupported method is called. Before,
  it threw when one was read.
- `theme-provider.tsx` applies a theme with the shared rule: the `light`
  class and `color-scheme` as well as `dark`, as the preload already did.
- The IPC handlers take a missing payload as empty. Before, some threw on
  destructuring `undefined`.

Recovery: docs/architecture/tasks/desktop-bridge.md#DSK-01.
