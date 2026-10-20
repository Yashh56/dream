/**
 * The store following the connection runtime (lib/connections/):
 *
 *   - Back in the foreground after a while, or back online: every loaded
 *     host's catalog is fetched again (changes may have been missed while
 *     the client was frozen) and running turns are followed on fresh
 *     streams. The host sockets replace themselves (lib/host-socket.ts).
 *   - A browser client's home host that could not be reached at startup
 *     (its projects shown from the snapshot) has its catalog brought in as
 *     soon as it is ready.
 *
 * Nothing here replays a write: an ambiguous chat submission is retried by
 * its durable request id (chat-runtime.ts), and every other write is the
 * user's to make again.
 */
import { connectionSupervisor } from "@/lib/connections/runtime";
import { LOCAL_HOST_ID } from "@/lib/host-routing";
import { STALE_AFTER_HIDDEN_MS } from "@/lib/host-socket";
import { reattachChatStreams } from "../chat/chat-runtime";
import { hostCatalogLifecycle } from "./host-catalog-lifecycle";
import { isHostLoaded } from "./ide-store-persistence";
import type { IdeState, IdeStoreSet } from "./ide-store-types";

export const followConnections = (store: {
  setState: IdeStoreSet;
  getState: () => IdeState;
}) => {
  const catalogs = () => hostCatalogLifecycle(store.setState, store.getState);
  const refresh = (hostId: string) => {
    void catalogs()
      .refresh(hostId)
      .catch(() => undefined);
  };

  const stopResume = connectionSupervisor.onResume(({ hiddenMs, reason }) => {
    if (!store.getState().stateHydrated) return;
    if (reason !== "online" && hiddenMs < STALE_AFTER_HIDDEN_MS) return;
    const hosts = store.getState().hosts;
    refresh(LOCAL_HOST_ID);
    for (const [hostId, host] of Object.entries(hosts)) {
      if (host.state === "connected") refresh(hostId);
    }
    reattachChatStreams();
  });

  const stopReady = connectionSupervisor.subscribe((hostId, state) => {
    if (
      hostId === LOCAL_HOST_ID &&
      state.status === "ready" &&
      store.getState().stateHydrated &&
      !isHostLoaded(LOCAL_HOST_ID)
    ) {
      refresh(LOCAL_HOST_ID);
    }
  });

  return () => {
    stopResume();
    stopReady();
  };
};
