/** Connection recovery owns lifecycle policy; sockets and catalogs own their state. */
import { LOCAL_HOST_ID } from "../host-routing";
import type {
  ConnectionSupervisor,
  LifecycleSignals,
  ResumeEvent,
} from "./supervisor";

export const STALE_AFTER_HIDDEN_MS = 15_000;

interface RecoverySocket {
  connect(): void;
  suspend(): void;
}

export interface RecoveryWorkspace {
  /** Eligible hosts, empty until the workspace is hydrated. */
  hosts(): string[];
  isLoaded(hostId: string): boolean;
  catalogs: {
    suspend(hostId: string): void;
    resume(hostId: string): void;
    refresh(hostId: string): Promise<void>;
  };
  reattach(hostId: string): void;
}

export const createConnectionRecovery = (supervisor: ConnectionSupervisor) => {
  const sockets = new Map<string, RecoverySocket>();
  const attempts = new Map<string, symbol>();
  const staleCatalogs = new Set<string>();
  let workspace: RecoveryWorkspace | null = null;
  let probeHome: (() => Promise<unknown>) | undefined;
  let stopLifecycle: (() => void) | undefined;

  const canConnect = (hostId: string) => {
    const { status } = supervisor.get(hostId);
    return status !== "unauthorized" && status !== "incompatible";
  };
  const suspend = (hostId: string) => {
    staleCatalogs.add(hostId);
    attempts.delete(hostId);
    sockets.get(hostId)?.suspend();
    workspace?.catalogs.suspend(hostId);
  };

  const recover = async (hostId: string, replace: boolean, probe = false) => {
    if (!canConnect(hostId)) return;
    const target = workspace;
    if (replace) suspend(hostId);
    const token = Symbol(hostId);
    attempts.set(hostId, token);
    const current = () => attempts.get(hostId) === token && canConnect(hostId);
    try {
      if (probe && hostId === LOCAL_HOST_ID) await probeHome?.();
      if (!current()) return;
      sockets.get(hostId)?.connect();
      if (target && target === workspace && target.hosts().includes(hostId)) {
        target.catalogs.resume(hostId);
        await target.catalogs.refresh(hostId);
        if (
          current() &&
          target === workspace &&
          target.hosts().includes(hostId)
        ) {
          staleCatalogs.delete(hostId);
          target.reattach(hostId);
        }
      }
    } catch {
      // Request outcomes and catalog readiness retain the visible error.
    } finally {
      if (attempts.get(hostId) === token) attempts.delete(hostId);
    }
  };

  const resume = async ({ hiddenMs, reason }: ResumeEvent) => {
    const replace = reason === "online" || hiddenMs >= STALE_AFTER_HIDDEN_MS;
    const hosts = new Set([...sockets.keys(), ...(workspace?.hosts() ?? [])]);
    if (probeHome) hosts.add(LOCAL_HOST_ID);
    if (!replace) {
      for (const hostId of hosts)
        if (canConnect(hostId)) sockets.get(hostId)?.connect();
      return;
    }
    await Promise.all([...hosts].map((hostId) => recover(hostId, true, true)));
  };

  const stopResume = supervisor.onResume((event) => {
    void resume(event);
  });
  const stopState = supervisor.subscribe((hostId, state) => {
    if (!canConnect(hostId)) {
      suspend(hostId);
    } else if (state.status === "ready" && !attempts.has(hostId)) {
      sockets.get(hostId)?.connect();
      if (
        workspace?.hosts().includes(hostId) &&
        (staleCatalogs.has(hostId) || !workspace.isLoaded(hostId))
      )
        void recover(hostId, false);
    }
  });

  return {
    canConnect,
    /** A verified replacement route invalidates observers of the old route. */
    replace: (hostId: string) => recover(hostId, true),
    resume,
    start(options: {
      lifecycle: LifecycleSignals;
      probeHome?: () => Promise<unknown>;
    }) {
      stopLifecycle?.();
      probeHome = options.probeHome;
      stopLifecycle = supervisor.follow(options.lifecycle);
      if (probeHome) void recover(LOCAL_HOST_ID, false, true);
    },
    registerSocket(hostId: string, socket: RecoverySocket) {
      sockets.set(hostId, socket);
      return () => {
        if (sockets.get(hostId) !== socket) return;
        suspend(hostId);
        sockets.delete(hostId);
        staleCatalogs.delete(hostId);
      };
    },
    bindWorkspace(next: RecoveryWorkspace) {
      workspace = next;
      return () => {
        if (workspace !== next) return;
        for (const hostId of attempts.keys()) next.catalogs.suspend(hostId);
        attempts.clear();
        workspace = null;
      };
    },
    dispose() {
      stopLifecycle?.();
      stopResume();
      stopState();
      for (const hostId of new Set([...sockets.keys(), ...attempts.keys()]))
        suspend(hostId);
      sockets.clear();
      staleCatalogs.clear();
      probeHome = undefined;
      workspace = null;
    },
  };
};

export type ConnectionRecovery = ReturnType<typeof createConnectionRecovery>;
