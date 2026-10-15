// Worker thread that answers persisted-state READS on a connection of its
// own (state-read-pool.js runs a few). The writes stay with the save worker;
// in WAL mode these reads neither wait for it nor hold it up, so a search
// across every transcript, or a transcript of megabytes, never stalls the
// thread that serves the window, terminals and the host socket.
import { parentPort, workerData } from "node:worker_threads";

import { catalogReads } from "./host/catalog-store.js";
import { openPersistedStateReader } from "./persisted-state.js";

if (!parentPort) {
  throw new Error(
    "persisted-state-read-worker must be run as a worker thread.",
  );
}

/** @type {import("node:sqlite").DatabaseSync | null} */
let database = null;

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") {
    return;
  }

  const { id, payload, type } = message;

  try {
    if (type === "close") {
      database?.close();
      database = null;
      parentPort.postMessage({ id, ok: true, result: true });
      return;
    }

    const read = Object.hasOwn(catalogReads, type) ? catalogReads[type] : null;
    if (!read) {
      throw new Error(`Unknown read: ${String(type)}`);
    }
    database ??= openPersistedStateReader(workerData?.databasePath);
    parentPort.postMessage({ id, ok: true, result: read(database, payload) });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
