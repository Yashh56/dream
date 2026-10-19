/** One per-store owner of catalog readiness, shared by every host trigger. */
import { LOCAL_HOST_ID } from "@/lib/host-routing";
import { getProjectHostId } from "../../../../electron/shared/persisted-state-codec.js";
import { isHostLoaded, loadCatalog } from "./ide-store-persistence";
import type { IdeStoreGet, IdeStoreSet } from "./ide-store-types";

const lifecycles = new WeakMap<
  IdeStoreGet,
  ReturnType<typeof createLifecycle>
>();

export const hostCatalogLifecycle = (set: IdeStoreSet, get: IdeStoreGet) => {
  let lifecycle = lifecycles.get(get);
  if (!lifecycle) {
    lifecycle = createLifecycle(set, get);
    lifecycles.set(get, lifecycle);
  }
  return lifecycle;
};

function createLifecycle(set: IdeStoreSet, get: IdeStoreGet) {
  const pending = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  const suspended = new Set<string>();
  const connections = new Map<string, AbortController>();
  const connection = (hostId: string) => {
    let controller = connections.get(hostId);
    if (!controller) {
      controller = new AbortController();
      connections.set(hostId, controller);
    }
    return controller;
  };

  const readiness = (hostId: string, loaded: boolean, error: string | null) => {
    if (hostId === LOCAL_HOST_ID) return;
    set((state) => {
      const host = state.hosts?.[hostId];
      if (!host) return state;
      return {
        hosts: { ...state.hosts, [hostId]: { ...host, loaded, error } },
      };
    });
  };

  return {
    /** Internal read seam: accept the result and apply it in the same turn. */
    async read(
      hostId: string,
      apply: (catalog: Awaited<ReturnType<typeof loadCatalog>>) => void,
    ) {
      const { signal } = connection(hostId);
      signal.throwIfAborted();
      const catalog = await loadCatalog(hostId, undefined, signal);
      signal.throwIfAborted();
      apply(catalog);
    },
    /** Transport is going away. Keep saved baselines, but reject old reads. */
    suspend(hostId: string) {
      suspended.add(hostId);
      connection(hostId).abort();
      pending.delete(hostId);
      readiness(hostId, false, null);
    },
    /** A new transport connection may now bring its catalog in. */
    resume(hostId: string) {
      suspended.delete(hostId);
      if (connection(hostId).signal.aborted)
        connections.set(hostId, new AbortController());
    },
    refresh(hostId: string): Promise<void> {
      if (get().stateHydrated === false)
        return Promise.reject(new Error("The workspace has not loaded yet."));
      if (suspended.has(hostId))
        return Promise.reject(
          new DOMException("Host catalog load superseded.", "AbortError"),
        );
      const current = pending.get(hostId);
      if (current) return current.promise;
      const controller = connection(hostId);
      readiness(hostId, false, null);
      // Defer the load so synchronous host events also find the pending entry.
      const promise = Promise.resolve()
        .then(async () => {
          controller.signal.throwIfAborted();
          if (hostId === LOCAL_HOST_ID || isHostLoaded(hostId))
            await get().reloadCatalog(hostId);
          else await get().loadHostCatalog(hostId);
          controller.signal.throwIfAborted();
          readiness(hostId, true, null);
          for (const project of get().projects) {
            if (getProjectHostId(project) === hostId)
              get().bumpProjectGitRefreshKey?.(project.id);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            readiness(
              hostId,
              false,
              error instanceof Error ? error.message : String(error),
            );
          throw error;
        })
        .finally(() => {
          if (pending.get(hostId)?.controller === controller)
            pending.delete(hostId);
        });
      pending.set(hostId, { controller, promise });
      return promise;
    },
  };
}
