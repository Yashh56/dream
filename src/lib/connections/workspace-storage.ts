/**
 * Where a client keeps its own workspace: config (top-level fields and
 * settings), saved prompts and its workspace rows. Never a host's catalog.
 *
 *   desktop   the Electron main process, over IPC (its SQLite database)
 *   browser   IndexedDB, in this origin, one database per client profile
 *
 * Both take the same change sets (store/workspace-save.ts) and give back
 * the same raw PersistedWorkspace, so the codec and the save rules are
 * written once. `applyWorkspaceChanges` is what the main process's SQL
 * does (electron/persisted-state.js), on a plain object.
 */
import type {
  DesktopApi,
  PersistedWorkspace,
  PersistedWorkspaceProject,
  SavedPrompt,
  WorkspaceChanges,
} from "@/types/ide";
import { stateFromConfig } from "../../../electron/shared/persisted-state-codec.js";

export interface WorkspaceStorage {
  /** The workspace as stored, after every save that resolved before it. */
  load(): Promise<PersistedWorkspace>;
  /** Writes one change set; resolves once it is stored. */
  saveChanges(changes: WorkspaceChanges): Promise<boolean>;
  /** Removes everything this client stored (a forgotten connection). */
  clear(): Promise<void>;
}

/** The stored form: what the main process keeps in its tables. */
export interface StoredWorkspace {
  config: Record<string, unknown>;
  savedPrompts: SavedPrompt[];
  rows: PersistedWorkspaceProject[];
}

export const emptyStoredWorkspace = (): StoredWorkspace => ({
  config: {},
  rows: [],
  savedPrompts: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isRow = (row: unknown): row is PersistedWorkspaceProject =>
  isRecord(row) &&
  typeof row.hostId === "string" &&
  typeof row.projectId === "string";

const rowKey = (row: { hostId: string; projectId: string }) =>
  `${row.hostId}\u0000${row.projectId}`;

/**
 * `stored` with `changes` applied, as the main process applies them:
 * config keys replaced, saved prompts replaced whole (keeping each one's
 * first `createdAt`), rows upserted, moved (status and place only) and
 * removed. A move for a row that does not exist inserts it, as SQL does.
 */
export const applyWorkspaceChanges = (
  stored: StoredWorkspace,
  changes: WorkspaceChanges,
): StoredWorkspace => {
  const config = { ...stored.config, ...(changes.config ?? {}) };

  let savedPrompts = stored.savedPrompts;
  if (Array.isArray(changes.savedPrompts)) {
    const createdAt = new Map(
      stored.savedPrompts.map((prompt) => [prompt.id, prompt.createdAt]),
    );
    savedPrompts = changes.savedPrompts.map((prompt) => ({
      ...prompt,
      createdAt: createdAt.get(prompt.id) ?? prompt.createdAt,
    }));
  }

  const rows = new Map(stored.rows.map((row) => [rowKey(row), row]));
  for (const row of changes.upsertRows ?? []) {
    if (isRow(row)) rows.set(rowKey(row), row);
  }
  for (const row of changes.moveRows ?? []) {
    if (!isRow(row)) continue;
    const existing = rows.get(rowKey(row));
    rows.set(
      rowKey(row),
      existing
        ? { ...existing, sortOrder: row.sortOrder, status: row.status }
        : row,
    );
  }
  for (const row of changes.removeRows ?? []) {
    if (isRecord(row)) rows.delete(rowKey(row as PersistedWorkspaceProject));
  }

  return { config, rows: [...rows.values()], savedPrompts };
};

/** The raw workspace a stored one loads as (main's loadPersistedState). */
export const workspaceFromStored = (
  stored: StoredWorkspace,
): PersistedWorkspace => ({
  ...stateFromConfig(stored.config),
  savedPrompts: stored.savedPrompts,
  // Grouped as main orders them: by host, open before closed, by place.
  workspaceProjects: [...stored.rows].sort(
    (a, b) =>
      a.hostId.localeCompare(b.hostId) ||
      Number(a.status === "closed") - Number(b.status === "closed") ||
      a.sortOrder - b.sortOrder,
  ),
});

/** The desktop's workspace: the main process's database, over IPC. */
export const createDesktopWorkspaceStorage = (
  desktopApi: DesktopApi,
): WorkspaceStorage => ({
  load: () => desktopApi.loadState(),
  saveChanges: (changes) => desktopApi.saveWorkspaceChanges(changes),
  // The desktop's workspace is the app's own; nothing forgets it.
  clear: async () => undefined,
});

const STORE = "workspace";
const KEY = "current";

const request = <T>(operation: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });

/**
 * A browser client's workspace in IndexedDB. Writes are applied one at a
 * time in the order they were made, each in its own transaction, so a
 * load sees every save that resolved before it.
 */
export const createIndexedDbWorkspaceStorage = ({
  databaseName = "dream-workspace",
  indexedDb = globalThis.indexedDB,
}: {
  databaseName?: string;
  indexedDb?: IDBFactory;
} = {}): WorkspaceStorage => {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!indexedDb) {
        reject(new Error("This browser cannot store a workspace."));
        return;
      }
      const opened = indexedDb.open(databaseName, 1);
      opened.onupgradeneeded = () => opened.result.createObjectStore(STORE);
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    }).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  };

  const read = async (): Promise<StoredWorkspace> => {
    const database = await open();
    const value = await request(
      database.transaction(STORE, "readonly").objectStore(STORE).get(KEY),
    );
    if (!isRecord(value)) return emptyStoredWorkspace();
    return {
      config: isRecord(value.config) ? value.config : {},
      rows: Array.isArray(value.rows) ? value.rows.filter(isRow) : [],
      savedPrompts: Array.isArray(value.savedPrompts)
        ? (value.savedPrompts as SavedPrompt[])
        : [],
    };
  };

  // One write at a time: each reads what the one before it wrote.
  let writing: Promise<unknown> = Promise.resolve();
  const serially = <T>(work: () => Promise<T>) => {
    const next = writing.then(work, work);
    writing = next.catch(() => undefined);
    return next;
  };

  return {
    load: () => serially(async () => workspaceFromStored(await read())),

    saveChanges: (changes) =>
      serially(async () => {
        const next = applyWorkspaceChanges(await read(), changes);
        const database = await open();
        await request(
          database
            .transaction(STORE, "readwrite")
            .objectStore(STORE)
            .put(
              // Structured clone: plain JSON, as the main process stores it.
              JSON.parse(JSON.stringify(next)),
              KEY,
            ),
        );
        return true;
      }),

    clear: () =>
      serially(async () => {
        const database = await open();
        await request(
          database.transaction(STORE, "readwrite").objectStore(STORE).clear(),
        );
      }),
  };
};
