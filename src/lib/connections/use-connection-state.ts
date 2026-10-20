/** A host's connection state (supervisor.ts), for React. */
import { useCallback, useSyncExternalStore } from "react";
import { connectionSupervisor } from "./runtime";
import type { ConnectionState } from "./supervisor";

export const useConnectionState = (hostId: string): ConnectionState => {
  const subscribe = useCallback(
    (onChange: () => void) =>
      connectionSupervisor.subscribe((changed) => {
        if (changed === hostId) onChange();
      }),
    [hostId],
  );
  const read = useCallback(() => connectionSupervisor.get(hostId), [hostId]);
  return useSyncExternalStore(subscribe, read, read);
};
