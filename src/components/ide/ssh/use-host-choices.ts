import { useMemo } from "react";
import { listHostChoices } from "../../../../electron/shared/host-connections.js";
import { useIdeStore } from "../ide-store";

/** Stable host choices shared by Settings, project opening and host labels. */
export function useHostChoices() {
  const connections = useIdeStore((state) => state.hostConnections);
  const sshHosts = useIdeStore((state) => state.settings.sshHosts);
  return useMemo(
    () => listHostChoices(connections, sshHosts),
    [connections, sshHosts],
  );
}
