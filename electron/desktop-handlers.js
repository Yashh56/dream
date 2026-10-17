// @ts-check
// What the main process does for each desktop method the renderer calls
// (shared/desktop-channels.js), as plain functions of the call's payload.
// Everything Electron and the app provide is passed in, so the handlers are
// tested with fakes (desktop-handlers.test.js) and main.js only wires them:
// `registerDesktopHandlers` puts each one on its channel.
//
// Not here: the update methods (updater.js) and the browser agent's
// guest and command-result messages (browser-agent-bridge.js), which
// register themselves on the same table's channels.
import path from "node:path";
import { DESKTOP_METHODS } from "./shared/desktop-channels.js";

/** @typedef {import("./shared/desktop-channels.js").DesktopMethod} DesktopMethod */

/**
 * @typedef {object} DesktopWindow
 * @property {() => boolean} isMinimized
 * @property {() => boolean} isMaximized
 * @property {() => void} minimize
 * @property {() => void} maximize
 * @property {() => void} unmaximize
 * @property {() => void} restore
 * @property {() => void} show
 * @property {() => void} focus
 * @property {() => void} close
 * @property {(color: string) => void} setBackgroundColor
 * @property {unknown} webContents
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** @param {unknown} bytes */
export const isPngBytes = (bytes) =>
  bytes instanceof Uint8Array &&
  bytes.length > PNG_SIGNATURE.length &&
  PNG_SIGNATURE.every((value, index) => bytes[index] === value);

/** @param {string} value */
export const isHttpUrl = (value) => /^https?:\/\//i.test(value.trim());

/**
 * @param {any} payload
 * @returns {Record<string, any>}
 */
const fields = (payload) =>
  payload && typeof payload === "object" ? payload : {};

/**
 * @param {object} deps
 * @param {() => DesktopWindow | null} deps.getWindow The main window, while
 *   it is alive.
 * @param {(channel: string, payload?: unknown) => void} deps.sendToRenderer
 * @param {object} deps.electron Electron's parts the handlers use.
 * @param {{ writeText: (text: string) => void, write: (items: unknown[]) => Promise<void> }} deps.electron.clipboard
 * @param {new (items: Record<string, Blob>) => unknown} deps.electron.ClipboardItem
 * @param {{ showSaveDialog: (...args: any[]) => Promise<{ canceled: boolean, filePath?: string }>, showOpenDialog: (...args: any[]) => Promise<{ canceled: boolean, filePaths: string[] }> }} deps.electron.dialog
 * @param {{ isSupported: () => boolean, new (options: { body: string, silent: boolean, title: string }): { on: (event: string, listener: () => void) => void, show: () => void } }} deps.electron.Notification
 * @param {{ openExternal: (url: string) => unknown, openPath: (path: string) => Promise<string>, showItemInFolder: (path: string) => void }} deps.electron.shell
 * @param {(name: "pictures") => string} deps.getPath
 * @param {{ exists: (path: string) => boolean, writeFile: (path: string, contents: string) => Promise<void> }} deps.files
 * @param {ReturnType<typeof import("./theme-store.js").createThemeStore>} deps.themes
 * @param {() => boolean} deps.systemPrefersDark
 * @param {{ loadWorkspace: () => unknown, saveWorkspaceChanges: (changes: unknown) => unknown }} deps.state
 * @param {{ connect: (options: { hostCommand?: string, hostId: string, target: string }) => Promise<{ hostProtocolVersion: number, version?: string | null }>, disconnect: (hostId: string) => void, getState: (hostId: string) => unknown, forwardPort: (hostId: string, port: number) => unknown }} deps.sshHosts
 * @param {{ answer: (promptId: unknown, answer: unknown) => void }} deps.sshPrompts
 * @param {{ update: (payload: unknown) => void, capturePage: (payload: unknown) => unknown }} deps.browserSessions
 * @param {{ detect: () => unknown, open: (options: { editorId: unknown, projectPath: unknown, sshTarget: unknown }) => unknown }} deps.editors
 * @param {(options: { chooseSavePath: (fileName: string) => Promise<string | null>, copyPng: (png: Uint8Array) => Promise<void>, webContents: unknown }) => Promise<{ status: string, filePath?: string }>} deps.captureAppScreenshot
 */
export const createDesktopHandlers = ({
  browserSessions,
  captureAppScreenshot,
  editors,
  electron: { ClipboardItem, clipboard, dialog, Notification, shell },
  files,
  getPath,
  getWindow,
  sendToRenderer,
  sshHosts,
  sshPrompts,
  state,
  systemPrefersDark,
  themes,
}) => {
  /**
   * Electron 44 removed clipboard.writeImage; images go through the
   * W3C-style clipboard.write([ClipboardItem]) API instead.
   * @param {Uint8Array} png
   */
  const writePngToClipboard = (png) =>
    clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([/** @type {BlobPart} */ (png)], {
          type: "image/png",
        }),
      }),
    ]);

  const paintWindowBackground = () => {
    getWindow()?.setBackgroundColor(
      themes.windowBackground(systemPrefersDark()),
    );
  };

  // Folder of the last saved screenshot, so the next Save dialog opens
  // there; starts in the user's Pictures folder, not kept across launches.
  /** @type {string | null} */
  let lastScreenshotDirectory = null;
  // Paths saved this session; "Show in folder" only reveals these.
  /** @type {Set<string>} */
  const savedScreenshotPaths = new Set();

  /** @param {string} defaultFileName */
  const chooseScreenshotSavePath = async (defaultFileName) => {
    const window = getWindow();
    if (!window) return null;
    const directory = lastScreenshotDirectory ?? getPath("pictures");
    const result = await dialog.showSaveDialog(window, {
      defaultPath: path.join(directory, defaultFileName),
      filters: [{ extensions: ["png"], name: "PNG image" }],
      title: "Save screenshot",
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  };

  // Shown notifications are held until they close: a collected
  // notification never delivers its click.
  /** @type {Set<unknown>} */
  const shownNotifications = new Set();

  /** @satisfies {Partial<Record<DesktopMethod, (payload: any) => unknown>>} */
  const handlers = {
    openExternal: (/** @type {unknown} */ payload) => {
      const { url } = fields(payload);
      if (typeof url !== "string" || !url || !isHttpUrl(url)) return false;
      shell.openExternal(url);
      return true;
    },

    openPath: async (/** @type {unknown} */ payload) => {
      const { path: targetPath } = fields(payload);
      if (
        typeof targetPath !== "string" ||
        !targetPath ||
        !path.isAbsolute(targetPath)
      ) {
        return false;
      }
      return (await shell.openPath(targetPath)) === "";
    },

    writeClipboardText: (/** @type {unknown} */ payload) => {
      const { text } = fields(payload);
      if (typeof text !== "string") return false;
      clipboard.writeText(text);
      return true;
    },

    writeClipboardImage: async (/** @type {unknown} */ payload) => {
      const { png } = fields(payload);
      if (!isPngBytes(png)) return false;
      try {
        await writePngToClipboard(png);
        return true;
      } catch (error) {
        console.error("Failed to copy image to clipboard:", error);
        return false;
      }
    },

    saveTextFile: async (/** @type {unknown} */ payload) => {
      const { contents, defaultPath, title = "Save file" } = fields(payload);
      if (typeof contents !== "string") return false;
      const options = {
        defaultPath:
          typeof defaultPath === "string" && defaultPath.trim()
            ? defaultPath.trim()
            : undefined,
        title,
      };
      const window = getWindow();
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return false;
      await files.writeFile(result.filePath, contents);
      return true;
    },

    captureAppScreenshot: async () => {
      const result = await captureAppScreenshot({
        chooseSavePath: chooseScreenshotSavePath,
        copyPng: writePngToClipboard,
        webContents: getWindow()?.webContents,
      });
      if (result.status === "saved" && result.filePath) {
        savedScreenshotPaths.add(result.filePath);
        lastScreenshotDirectory = path.dirname(result.filePath);
      }
      return result;
    },

    showScreenshotInFolder: (/** @type {unknown} */ payload) => {
      const { path: targetPath } = fields(payload);
      if (!savedScreenshotPaths.has(targetPath) || !files.exists(targetPath)) {
        return false;
      }
      shell.showItemInFolder(targetPath);
      return true;
    },

    showNotification: (/** @type {unknown} */ payload) => {
      const { body, chatId, silent, title } = fields(payload);
      if (
        typeof title !== "string" ||
        !title.trim() ||
        !Notification.isSupported()
      ) {
        return false;
      }

      const notification = new Notification({
        body: typeof body === "string" ? body.slice(0, 500) : "",
        silent: silent === true,
        title: title.slice(0, 200),
      });
      const release = () => shownNotifications.delete(notification);
      notification.on("click", () => {
        release();
        const window = getWindow();
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        if (typeof chatId === "string" && chatId) {
          sendToRenderer(DESKTOP_METHODS.onNotificationClicked.channel, {
            chatId,
          });
        }
      });
      notification.on("close", release);
      notification.on("failed", release);
      shownNotifications.add(notification);
      notification.show();
      return true;
    },

    // Window controls (the frameless window on Windows and Linux).
    windowMinimize: () => {
      getWindow()?.minimize();
    },
    windowMaximize: () => {
      const window = getWindow();
      if (window?.isMaximized()) window.unmaximize();
      else window?.maximize();
    },
    windowClose: () => {
      getWindow()?.close();
    },

    pickProjectDirectory: async () => {
      const window = getWindow();
      if (!window) return null;
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "Select project folder",
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0] ?? null;
    },

    // Read by the save worker, after every write queued before it: a
    // refreshed renderer sees what the old document saved.
    loadState: () => state.loadWorkspace(),
    saveWorkspaceChanges: (/** @type {unknown} */ changes) =>
      state.saveWorkspaceChanges(changes),

    getThemePreferences: () => themes.get(),
    setThemePreference: (/** @type {unknown} */ payload) => {
      themes.update({ theme: fields(payload).theme });
      paintWindowBackground();
      return true;
    },
    setBaseColor: (/** @type {unknown} */ payload) => {
      themes.update({ baseColor: fields(payload).baseColor });
      paintWindowBackground();
      return true;
    },
    setAccentColor: (/** @type {unknown} */ payload) => {
      themes.update({ accentColor: fields(payload).accentColor });
      return true;
    },

    connectHost: async (/** @type {unknown} */ payload) => {
      const { hostCommand, hostId, target } = fields(payload);
      if (
        typeof hostId !== "string" ||
        typeof target !== "string" ||
        !target.trim()
      ) {
        throw new Error("A host needs an id and an SSH target.");
      }
      const endpoint = await sshHosts.connect({
        hostCommand:
          typeof hostCommand === "string" && hostCommand.trim()
            ? hostCommand.trim()
            : undefined,
        hostId,
        target: target.trim(),
      });
      // The token stays in this process; the renderer goes through the proxy.
      return {
        hostProtocolVersion: endpoint.hostProtocolVersion,
        version: endpoint.version ?? null,
      };
    },
    disconnectHost: (/** @type {unknown} */ payload) => {
      const { hostId } = fields(payload);
      if (typeof hostId === "string") sshHosts.disconnect(hostId);
      return true;
    },
    getHostState: (/** @type {unknown} */ payload) => {
      const { hostId } = fields(payload);
      return typeof hostId === "string" ? sshHosts.getState(hostId) : "idle";
    },
    // A port on an SSH host (its dev server) forwarded here, for the
    // browser panel; resolves with the local port.
    forwardHostPort: (/** @type {unknown} */ payload) => {
      const { hostId, port } = fields(payload);
      const remotePort = Number(port);
      if (
        typeof hostId !== "string" ||
        !Number.isInteger(remotePort) ||
        remotePort < 1 ||
        remotePort > 65_535
      ) {
        throw new Error("A host and a port are needed.");
      }
      return sshHosts.forwardPort(hostId, remotePort);
    },
    answerHostPrompt: (/** @type {unknown} */ payload) => {
      const { answer, promptId } = fields(payload);
      sshPrompts.answer(promptId, answer);
    },

    updateBrowser: (/** @type {unknown} */ payload) => {
      browserSessions.update(payload);
    },
    captureBrowserPage: (/** @type {unknown} */ payload) =>
      browserSessions.capturePage(payload),

    detectEditors: () => editors.detect(),
    openInEditor: (/** @type {unknown} */ payload) => {
      const { editorId, projectPath, sshTarget } = fields(payload);
      return editors.open({ editorId, projectPath, sshTarget });
    },
  };

  return { handlers, paintWindowBackground };
};

/**
 * Puts each handler on its method's channel: an `invoke` method answers,
 * a `send` method only listens.
 * @param {{ handle: (channel: string, listener: (event: unknown, payload: unknown) => unknown) => void, on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void }} ipcMain
 * @param {Partial<Record<DesktopMethod, (payload: any) => unknown>>} handlers
 */
export const registerDesktopHandlers = (ipcMain, handlers) => {
  for (const [method, handler] of Object.entries(handlers)) {
    const spec = DESKTOP_METHODS[/** @type {DesktopMethod} */ (method)];
    if (!spec || spec.kind === "subscribe" || !handler) {
      throw new Error(`${method} is not a desktop method the renderer calls.`);
    }
    if (spec.kind === "invoke") {
      ipcMain.handle(spec.channel, (_event, payload) => handler(payload));
    } else {
      ipcMain.on(spec.channel, (_event, payload) => {
        handler(payload);
      });
    }
  }
};
