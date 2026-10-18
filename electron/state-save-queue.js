// Coalescing queue in front of the persisted-state save worker.
//
// Workspace change sets, transcripts, host catalog changes and single config
// values (theme, install id) share one worker: it holds the only connection
// that writes the database, so their order is deterministic and no thread
// that serves the UI waits on a write lock. Adjacent transcript saves of one
// chat are merged into one; everything else is a delta and runs as sent.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, "persisted-state-worker.js");
const FLUSH_TIMEOUT_MS = 5000;

const saveStartIndex = (payload) =>
  Number.isInteger(payload?.fromIndex) && payload.fromIndex > 0
    ? payload.fromIndex
    : 0;

/**
 * One transcript save standing for `queued` followed by `next`, or null when
 * they cannot be one (different chats, or `next` starts past where `queued`
 * ends). A save replaces its chat's transcript from `fromIndex` on, so the
 * later one wins from its own start and the queued one keeps what it said
 * before that.
 */
export const mergeChatMessageSaves = (queued, next) => {
  if (queued?.mergeOnly || next?.mergeOnly) return null;
  if (
    queued?.chatId !== next?.chatId ||
    !Array.isArray(queued?.messages) ||
    !Array.isArray(next?.messages)
  ) {
    return null;
  }
  const queuedStart = saveStartIndex(queued);
  const nextStart = saveStartIndex(next);
  if (nextStart <= queuedStart) return next;
  const kept = nextStart - queuedStart;
  if (kept > queued.messages.length) return null;
  return {
    ...next,
    fromIndex: queuedStart,
    messages: [...queued.messages.slice(0, kept), ...next.messages],
  };
};

export function createStateSaveQueue({ databasePath }) {
  /** @type {Worker | null} */
  let worker = null;
  let nextMessageId = 1;
  let busy = false;
  let closed = false;
  /** @type {Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>} */
  const inFlight = new Map();
  /** @type {Array<{ type: string, payload: any, resolvers: Array<{ resolve: (value: unknown) => void, reject: (error: Error) => void }> }>} */
  let pending = [];

  const failAll = (error) => {
    for (const entry of inFlight.values()) {
      entry.reject(error);
    }
    inFlight.clear();
    for (const operation of pending) {
      for (const resolver of operation.resolvers) {
        resolver.reject(error);
      }
    }
    pending = [];
    busy = false;
  };

  const ensureWorker = () => {
    if (worker) {
      return worker;
    }

    worker = new Worker(WORKER_PATH, {
      workerData: { databasePath },
    });

    worker.on("message", (message) => {
      const entry = inFlight.get(message?.id);
      if (entry) {
        inFlight.delete(message.id);
        if (message.ok) {
          entry.resolve(message.result ?? true);
        } else {
          entry.reject(new Error(message.error || "State save failed."));
        }
      }
      busy = false;
      drain();
    });

    worker.on("error", (error) => {
      worker = null;
      failAll(error instanceof Error ? error : new Error(String(error)));
    });

    worker.on("exit", (code) => {
      worker = null;
      if (code !== 0) {
        failAll(new Error(`State save worker exited with code ${code}.`));
      }
    });

    return worker;
  };

  const drain = () => {
    if (busy || pending.length === 0 || closed) {
      return;
    }

    const operation = pending.shift();
    if (!operation) {
      return;
    }
    busy = true;

    const id = nextMessageId++;
    inFlight.set(id, {
      resolve: (value) => {
        for (const resolver of operation.resolvers) {
          resolver.resolve(value);
        }
      },
      reject: (error) => {
        for (const resolver of operation.resolvers) {
          resolver.reject(error);
        }
      },
    });

    try {
      ensureWorker().postMessage({
        id,
        type: operation.type,
        payload: operation.payload,
      });
    } catch (error) {
      inFlight.delete(id);
      busy = false;
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const resolver of operation.resolvers) {
        resolver.reject(failure);
      }
    }
  };

  const saveChatMessages = (payload) => {
    if (closed) {
      return Promise.reject(new Error("State save queue is closed."));
    }

    return new Promise((resolve, reject) => {
      const latest = pending.at(-1);
      const merged =
        latest?.type === "save-chat-messages"
          ? mergeChatMessageSaves(latest.payload, payload)
          : null;
      if (merged) {
        latest.payload = merged;
        latest.resolvers.push({ resolve, reject });
      } else {
        pending.push({
          type: "save-chat-messages",
          payload,
          resolvers: [{ resolve, reject }],
        });
      }
      drain();
    });
  };

  /** Queues one operation that is never coalesced with another. */
  const enqueue = (type, payload) => {
    if (closed) {
      return Promise.reject(new Error("State save queue is closed."));
    }

    return new Promise((resolve, reject) => {
      pending.push({ type, payload, resolvers: [{ resolve, reject }] });
      drain();
    });
  };

  // A catalog change set is a delta, so it is never coalesced: each one is
  // applied, in order with every other write.
  const applyCatalogChanges = (payload) => enqueue("catalog-changes", payload);

  // What changed in the workspace since the renderer's last save: small,
  // and a delta, so never coalesced.
  const saveWorkspaceChanges = (payload) =>
    enqueue("save-workspace-changes", payload);

  // The workspace as stored, read by the worker after every write queued
  // before it (a reloaded window sees what the old one saved).
  const loadWorkspace = () => enqueue("load-workspace", null);

  // One config value ({ key, value }), written in order with the rest.
  const saveConfigValue = (payload) => enqueue("save-config", payload);

  // Settles once the worker has opened (created and migrated) the database:
  // what readers on other threads wait for before opening it themselves.
  let opened = null;
  const ready = () => {
    opened ??= enqueue("open", null).catch((error) => {
      opened = null;
      throw error;
    });
    return opened;
  };

  const flushAndClose = async () => {
    if (closed) {
      return;
    }

    const deadline = Date.now() + FLUSH_TIMEOUT_MS;
    while ((busy || pending.length > 0) && Date.now() < deadline) {
      drain();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    closed = true;

    const activeWorker = worker;
    worker = null;
    if (activeWorker) {
      try {
        await new Promise((resolve) => {
          const id = nextMessageId++;
          inFlight.set(id, { resolve, reject: resolve });
          activeWorker.postMessage({ id, type: "close" });
          setTimeout(resolve, 1000);
        });
      } finally {
        await activeWorker.terminate();
      }
    }
  };

  return {
    mutateRunQueue: (payload) => enqueue("run-queue", payload),
    saveProviderSession: (payload) => enqueue("save-provider-session", payload),
    saveChatMessages,
    applyCatalogChanges,
    saveWorkspaceChanges,
    loadWorkspace,
    ready,
    saveConfigValue,
    flushAndClose,
  };
}
