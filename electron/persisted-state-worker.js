// Worker thread that owns all persisted-state WRITES.
//
// Workspace change sets, transcript saves, host catalog changes and single
// config values use synchronous SQLite transactions. Running them here keeps
// the Electron main thread free even when a completed transcript contains
// large tool payloads.
//
// The parent passes the resolved database path in workerData so persisted-state.js
// never needs the (unavailable) "electron" module.
import { parentPort, workerData } from "node:worker_threads";

import {
  applyPersistedCatalogChanges,
  closePersistedStateDatabase,
  getPersistedStateDatabase,
  loadPersistedState,
  savePersistedChatMessages,
  savePersistedConfigValue,
  savePersistedWorkspaceChanges,
} from "./persisted-state.js";

if (!parentPort) {
  throw new Error("persisted-state-worker must be run as a worker thread.");
}

const databasePath =
  typeof workerData?.databasePath === "string" ? workerData.databasePath : null;
const options = { databasePath };

/**
 * Every operation the save queue (state-save-queue.js) sends, by message
 * type. A new write is one row here and one method on the queue.
 */
const operations = {
  // Opens (creating and migrating) the database, so readers on other
  // threads can open it after.
  open: () => {
    getPersistedStateDatabase(options);
    return true;
  },
  "save-config": (payload) => savePersistedConfigValue(payload, options),
  "save-chat-messages": (payload) =>
    savePersistedChatMessages(payload, options),
  "save-workspace-changes": (payload) =>
    savePersistedWorkspaceChanges(payload, options),
  "catalog-changes": (payload) =>
    applyPersistedCatalogChanges(payload, options),
  // A read, run here so the main thread never waits on SQLite, and in turn
  // with the writes queued before it.
  "load-workspace": () => loadPersistedState(options),
  close: () => {
    closePersistedStateDatabase();
    return true;
  },
};

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") {
    return;
  }

  const { id, type } = message;
  const operation = Object.hasOwn(operations, type) ? operations[type] : null;
  if (!operation) {
    parentPort.postMessage({
      id,
      ok: false,
      error: `Unknown message type: ${String(type)}`,
    });
    return;
  }

  try {
    parentPort.postMessage({
      id,
      ok: true,
      result: operation(message.payload),
    });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
