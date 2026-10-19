/**
 * SSH hosts in the store: connecting one (the main process runs ssh and
 * the host's daemon; this window then loads the host's catalog), its state
 * as main reports it, and opening a folder on it as a project. A host's
 * projects stay in the store while it is away, so its tabs do not vanish
 * with a dropped connection.
 *
 * An SSH host verified once (its saved connection) connects to that host
 * only: main refuses any other, then and on every reconnect.
 * A catalog refused for its host's identity (host-catalog-lifecycle.ts)
 * disconnects it: nothing of a host that is not the one meant is used.
 */
import { getDesktopApi } from "@/lib/electron";
import { LOCAL_HOST_ID } from "@/lib/host-routing";
import type { HostConnectionState } from "@/types/ide";
import {
  findHostConnection,
  forgetHostConnection,
} from "../../../../electron/shared/host-connections.js";
import {
  HostIdentityError,
  hostCatalogLifecycle,
} from "./host-catalog-lifecycle";
import { forgetLoadedHost } from "./ide-store-persistence";
import type { IdeState, IdeStoreGet, IdeStoreSet } from "./ide-store-types";
import { applyWorkspaceRemoval } from "./project-runtime-state";
import { settleSettings } from "./settings-actions";
import * as workspace from "./workspace-document";

// Electron prefixes errors thrown across ipcRenderer.invoke with where they
// came from; the user wants only what went wrong.
const IPC_ERROR_PREFIX =
  /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    IPC_ERROR_PREFIX,
    "",
  );

/** How long removing a host waits for its terminals to stop. */
const TERMINAL_STOP_WAIT_MS = 5_000;

/** Waits for `work` to settle, or `ms`, whichever comes first. */
const settleWithin = async (work: Promise<unknown>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
};

export const createHostActions = (
  set: IdeStoreSet,
  get: IdeStoreGet,
): Pick<
  IdeState,
  | "connectHost"
  | "resumeHosts"
  | "updateSshHost"
  | "disconnectHost"
  | "setHostStatus"
  | "openProjectOnHost"
  | "removeSshHost"
> => {
  const setHost = (
    hostId: string,
    patch: Partial<{
      state: HostConnectionState;
      error: string | null;
      loaded: boolean;
    }>,
  ) =>
    set((state) => ({
      hosts: {
        ...state.hosts,
        [hostId]: {
          ...{ error: null, loaded: false, state: "idle" as const },
          ...state.hosts[hostId],
          ...patch,
        },
      },
    }));

  const catalogs = hostCatalogLifecycle(set, get);
  const connecting = new Map<
    string,
    { token: symbol; promise: Promise<boolean> }
  >();
  const stopped = new Set<string>();
  const stopFollowing = (hostId: string) => {
    stopped.add(hostId);
    connecting.delete(hostId);
    catalogs.suspend(hostId);
  };

  /**
   * Brings `hostId`'s catalog in. A host refused for who it is gets
   * disconnected, with why; any other failure is left to the caller.
   */
  const refreshCatalog = async (hostId: string) => {
    try {
      await catalogs.refresh(hostId);
    } catch (error) {
      if (!(error instanceof HostIdentityError)) throw error;
      stopFollowing(hostId);
      await getDesktopApi()?.disconnectHost(hostId);
      setHost(hostId, { error: error.message, loaded: false, state: "failed" });
      throw error;
    }
  };

  const connectHost: IdeState["connectHost"] = (hostId) => {
    if (hostId === LOCAL_HOST_ID) return Promise.resolve(true);
    const pending = connecting.get(hostId);
    if (pending) return pending.promise;
    const token = Symbol(hostId);
    const current = () => connecting.get(hostId)?.token === token;
    stopped.delete(hostId);
    catalogs.resume(hostId);

    const run = (async () => {
      const desktopApi = getDesktopApi();
      const config = get().settings.sshHosts.find((host) => host.id === hostId);
      if (!desktopApi || !config) {
        setHost(hostId, {
          error: "This SSH host is not in Settings.",
          state: "failed",
        });
        return false;
      }

      setHost(hostId, { error: null, loaded: false, state: "connecting" });
      const saved = findHostConnection(get().hostConnections, hostId);
      try {
        await desktopApi.connectHost({
          expectedFingerprint: saved?.fingerprint ?? null,
          expectedHostId: saved?.hostId ?? null,
          hostCommand: config.hostCommand,
          hostId,
          target: config.target,
        });
        if (!current()) return false;
        setHost(hostId, { state: "connected" });
        await refreshCatalog(hostId);
        return current();
      } catch (error) {
        if (error instanceof HostIdentityError) return false;
        if (current())
          setHost(hostId, {
            error: errorMessage(error),
            loaded: false,
            state:
              get().hosts[hostId]?.state === "connected"
                ? "connected"
                : "failed",
          });
        return false;
      }
    })().finally(() => {
      if (current()) connecting.delete(hostId);
    });
    connecting.set(hostId, { token, promise: run });
    return run;
  };

  return {
    connectHost,

    resumeHosts: async (openHostIds) => {
      const desktopApi = getDesktopApi();
      const reopen = new Set(openHostIds);
      await Promise.all(
        get().settings.sshHosts.map(async (host) => {
          // Main keeps its connections across a reload of this window; ask
          // it rather than assume nothing is connected.
          const mainState = await desktopApi
            ?.getHostState(host.id)
            .catch(() => "idle" as const);
          if (
            stopped.has(host.id) ||
            !get().settings.sshHosts.some((item) => item.id === host.id)
          )
            return;
          if (mainState === "connected") {
            // Already there: connecting returns at once, without prompts.
            await connectHost(host.id);
          } else if (
            mainState === "connecting" ||
            mainState === "reconnecting"
          ) {
            // On its way: its status event brings the catalog in.
            setHost(host.id, { error: null, state: mainState });
          } else if (reopen.has(host.id)) {
            // Projects of it were open last time: connect again.
            await connectHost(host.id);
          }
        }),
      );
    },

    updateSshHost: async (hostId, patch) => {
      const previous = get().settings.sshHosts.find(
        (host) => host.id === hostId,
      );
      if (!previous) return;
      const next = { ...previous, ...patch, id: hostId };
      get().setSettings((settings) => ({
        ...settings,
        sshHosts: settings.sshHosts.map((host) =>
          host.id === hostId ? next : host,
        ),
      }));

      // Same host, reached differently: a live connection reconnects with
      // the new settings. Its projects stay (they are keyed by the host's
      // id, which does not change), and so does the host it was verified
      // as: a target that now reaches another host is refused.
      const reachedDifferently =
        next.target !== previous.target ||
        next.hostCommand !== previous.hostCommand;
      const live = get().hosts[hostId]?.state;
      if (
        reachedDifferently &&
        (live === "connected" ||
          live === "connecting" ||
          live === "reconnecting")
      ) {
        stopFollowing(hostId);
        await getDesktopApi()?.disconnectHost(hostId);
        await connectHost(hostId);
      }
    },

    removeSshHost: async (hostId) => {
      stopFollowing(hostId);
      // Its shells go with it, stopped while the host can still be reached.
      // A host that does not answer does not hold the removal up; one that
      // is not connected cannot be asked.
      if (get().hosts[hostId]?.state === "connected") {
        const state = get();
        const { removedProjectIds } = workspace.removeHostProjects(
          state,
          state.settings,
          hostId,
        );
        await settleWithin(
          Promise.all(
            removedProjectIds.map((projectId) =>
              get().stopProjectTerminals(projectId),
            ),
          ),
          TERMINAL_STOP_WAIT_MS,
        );
      }
      await getDesktopApi()?.disconnectHost(hostId);
      // Out of this window only: the host's catalog is not told.
      forgetLoadedHost(hostId);
      set((state) => {
        const { [hostId]: _removed, ...hosts } = state.hosts;
        const removed = applyWorkspaceRemoval(
          state,
          workspace.removeHostProjects(state, state.settings, hostId),
        );
        return {
          ...removed,
          ...settleSettings(
            { ...state, ...removed },
            {
              ...state.settings,
              sshHosts: state.settings.sshHosts.filter(
                (host) => host.id !== hostId,
              ),
            },
          ),
          hostConnections: forgetHostConnection(state.hostConnections, hostId),
          hosts,
        };
      });
      get().persist();
    },

    disconnectHost: async (hostId) => {
      stopFollowing(hostId);
      await getDesktopApi()?.disconnectHost(hostId);
      setHost(hostId, { error: null, state: "disconnected" });
    },

    setHostStatus: ({ error, hostId, state }) => {
      if (!get().settings.sshHosts.some((host) => host.id === hostId)) return;
      if (state === "connected" && stopped.has(hostId)) return;
      const previous = get().hosts[hostId]?.state;
      if (state !== "connected" && state !== "connecting") {
        connecting.delete(hostId);
        catalogs.suspend(hostId);
      }
      setHost(hostId, { error, state });
      // Connected without this window asking (back after a drop, or a
      // connection main had before this window reloaded): bring the
      // catalog in. A connect this window started does that itself.
      if (
        state === "connected" &&
        previous !== "connected" &&
        !connecting.has(hostId)
      ) {
        catalogs.resume(hostId);
        void refreshCatalog(hostId).catch(() => undefined);
      }
    },

    openProjectOnHost: async (hostId, path) => {
      const trimmed = path.trim();
      if (!trimmed) return false;
      // The host's projects must be here first: one already at this path
      // opens as itself, not as a second project the host would refuse.
      const runtime = get().hosts[hostId];
      if (runtime?.state !== "connected" || !runtime.loaded) {
        if (!(await connectHost(hostId))) return false;
      }
      get().addProject(trimmed, { hostId });
      return true;
    },
  };
};
