// A few worker threads that answer persisted-state reads, each on its own
// connection (persisted-state-read-worker.js): the read side of the one
// writer (state-save-queue.js).
//
// A read goes to the worker with the fewest reads waiting, so a transcript
// load is not stuck behind a search. Each read sees the last commit before
// it began: a read made after a write has settled sees that write. Reads
// start once `whenReady` settles (the writer has created and migrated the
// file); a reader never migrates it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, "persisted-state-read-worker.js");
const DEFAULT_POOL_SIZE = 2;
const CLOSE_TIMEOUT_MS = 1000;

/**
 * @param {{
 *   databasePath: string,
 *   size?: number,
 *   whenReady?: () => Promise<unknown>,
 * }} options
 */
export function createStateReadPool({
  databasePath,
  size = DEFAULT_POOL_SIZE,
  whenReady = async () => {},
}) {
  /**
   * @typedef {{
   *   worker: Worker | null,
   *   inFlight: Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>,
   * }} Slot
   */
  /** @type {Slot[]} */
  const slots = Array.from({ length: Math.max(1, size) }, () => ({
    inFlight: new Map(),
    worker: null,
  }));
  let nextMessageId = 1;
  let closed = false;
  /** @type {Promise<unknown> | null} */
  let ready = null;

  /** Ends a slot's worker and fails what it was answering. */
  const fail = (slot, worker, error) => {
    if (slot.worker !== worker) return;
    slot.worker = null;
    for (const entry of slot.inFlight.values()) entry.reject(error);
    slot.inFlight.clear();
  };

  const ensureWorker = (slot) => {
    if (slot.worker) return slot.worker;
    const worker = new Worker(WORKER_PATH, { workerData: { databasePath } });
    slot.worker = worker;
    worker.on("message", (message) => {
      const entry = slot.inFlight.get(message?.id);
      if (!entry) return;
      slot.inFlight.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error || "State read failed."));
    });
    worker.on("error", (error) =>
      fail(
        slot,
        worker,
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
    worker.on("exit", (code) =>
      fail(
        slot,
        worker,
        new Error(`State read worker exited with code ${code}.`),
      ),
    );
    return worker;
  };

  const post = (slot, type, payload) =>
    new Promise((resolve, reject) => {
      const id = nextMessageId++;
      slot.inFlight.set(id, { reject, resolve });
      try {
        ensureWorker(slot).postMessage({ id, payload, type });
      } catch (error) {
        slot.inFlight.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  /**
   * Runs one read (a name in host/catalog-store.js `catalogReads`).
   * @param {string} type
   * @param {unknown} [payload]
   */
  const read = async (type, payload = {}) => {
    if (closed) throw new Error("State read pool is closed.");
    ready ??= Promise.resolve()
      .then(whenReady)
      .catch((error) => {
        ready = null;
        throw error;
      });
    await ready;
    if (closed) throw new Error("State read pool is closed.");
    const slot = slots.reduce((least, candidate) =>
      candidate.inFlight.size < least.inFlight.size ? candidate : least,
    );
    return post(slot, type, payload);
  };

  /** Closes every reader's connection and ends its thread. */
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.all(
      slots.map(async (slot) => {
        const worker = slot.worker;
        if (!worker) return;
        let timer = null;
        await Promise.race([
          post(slot, "close").catch(() => {}),
          new Promise((resolve) => {
            timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
          }),
        ]);
        clearTimeout(timer);
        slot.worker = null;
        await worker.terminate();
        for (const entry of slot.inFlight.values()) {
          entry.reject(new Error("State read pool is closed."));
        }
        slot.inFlight.clear();
      }),
    );
  };

  return { close, read };
}
