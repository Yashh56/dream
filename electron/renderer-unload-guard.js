// @ts-check
// Terminal and run processes stop before the renderer that owns them goes
// away. Every way the page can unload comes through here:
//
//   a reload (the keyboard shortcut, the menu): processes stop, then the
//     page reloads (`reload`);
//   an in-app navigation: held until processes stop, then made
//     (`holdNavigation`);
//   a navigation that slipped past those, or a crashed renderer: processes
//     are stopped as it happens (`stopProcesses`).
//
// The renderer adds its own best effort on pagehide (src/components/ide/
// renderer-unload-guard.ts). One stop runs at a time, and one reload.

/**
 * @typedef {object} UnloadWebContents
 * @property {() => boolean} isDestroyed
 * @property {() => void} reload
 * @property {() => void} reloadIgnoringCache
 */

/**
 * @param {object} options
 * @param {{ hasActiveSessions: () => boolean, stopAllProcesses: () => Promise<void> }} options.processes
 * @param {(message: string, error: unknown) => void} [options.onError]
 */
export const createRendererUnloadGuard = ({
  processes,
  onError = (message, error) => console.error(message, error),
}) => {
  /** @type {Promise<void> | null} */
  let stopping = null;
  /** @type {Promise<void> | null} */
  let reloading = null;

  /** Stops every process; joins a stop already under way. Never rejects. */
  const stopProcesses = () => {
    stopping ??= processes
      .stopAllProcesses()
      .catch((error) => {
        onError(
          "Failed to stop managed processes before renderer unload:",
          error,
        );
      })
      .finally(() => {
        stopping = null;
      });
    return stopping;
  };

  return {
    stopProcesses,

    /**
     * Stops processes, then reloads `webContents`; joins a reload already
     * under way.
     * @param {UnloadWebContents | null | undefined} webContents
     * @param {{ ignoreCache?: boolean }} [options]
     */
    reload: (webContents, { ignoreCache = false } = {}) => {
      reloading ??= (async () => {
        if (!webContents || webContents.isDestroyed()) return;
        await stopProcesses();
        if (webContents.isDestroyed()) return;
        if (ignoreCache) webContents.reloadIgnoringCache();
        else webContents.reload();
      })().finally(() => {
        reloading = null;
      });
      return reloading;
    },

    /**
     * A navigation of the page is about to start. With processes running it
     * is held (true: the caller cancels it) and made by `navigate` once
     * they stop; else it goes ahead (false).
     * @param {() => void} navigate
     * @returns {boolean}
     */
    holdNavigation: (navigate) => {
      if (!processes.hasActiveSessions()) return false;
      void stopProcesses().then(navigate);
      return true;
    },
  };
};

/**
 * @typedef {object} KeyInput
 * @property {string} [type]
 * @property {string} [key]
 * @property {boolean} [control]
 * @property {boolean} [shift]
 * @property {boolean} [alt]
 * @property {boolean} [meta]
 * @property {boolean} [isAutoRepeat]
 */

/**
 * The reload a keystroke asks for (F5, Ctrl+F5, Ctrl/Cmd(+Shift)+R), or
 * null. Handled in the main process, so processes stop before the page
 * goes.
 * @param {KeyInput | null | undefined} input
 * @returns {{ ignoreCache: boolean } | null}
 */
export const getReloadShortcutOptions = (input) => {
  if (input?.type !== "keyDown") {
    return null;
  }

  const key = typeof input.key === "string" ? input.key.toLowerCase() : "";

  if (key === "f5" && !input.alt && !input.meta) {
    return { ignoreCache: Boolean(input.control) };
  }

  if (
    key === "r" &&
    (input.control || input.meta) &&
    !input.alt &&
    !input.isAutoRepeat
  ) {
    return { ignoreCache: Boolean(input.shift) };
  }

  return null;
};
