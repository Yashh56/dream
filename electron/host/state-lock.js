// One host per state database. A host's catalog has exactly one writer, so
// two host processes on one database (the desktop's and a service's, or two
// launchers' daemons) must not both run: the second refuses to start and
// says which process has it.
//
//   <state database>.host-lock   {"pid", "startedAt", "kind"}, created
//                                exclusively; removed when the host closes
//
// A lock whose process is gone (a crash, a power loss) is stale and taken
// over. Taking it over is an exclusive create too, so of two hosts starting
// at once one wins.
import { readFileSync, rmSync, writeFileSync } from "node:fs";

export class StateLockedError extends Error {
  /** @param {{ pid: number, startedAt?: string, kind?: string }} holder */
  constructor(lockPath, holder) {
    super(
      `Another Dream host (${holder.kind ?? "process"} ${holder.pid}, since ${holder.startedAt ?? "unknown"}) is using this host's data. Stop it, or connect to it instead of starting a second one.`,
    );
    this.name = "StateLockedError";
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it is just not ours to signal.
    return error?.code === "EPERM";
  }
};

const readHolder = (lockPath) => {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8"));
    return Number.isInteger(holder?.pid) ? holder : null;
  } catch {
    return null;
  }
};

/**
 * Takes the lock on `stateDatabasePath` for this process; returns its
 * release. Throws StateLockedError while another live process holds it.
 * @param {string} stateDatabasePath
 * @param {{ kind?: string, pid?: number, now?: () => string, alive?: (pid: number) => boolean }} [options]
 */
export function acquireStateLock(
  stateDatabasePath,
  {
    kind = "host",
    pid = process.pid,
    now = () => new Date().toISOString(),
    alive = isAlive,
  } = {},
) {
  const lockPath = `${stateDatabasePath}.host-lock`;
  const record = JSON.stringify({ kind, pid, startedAt: now() });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(lockPath, record, { flag: "wx", mode: 0o600 });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        // Only our own lock: never one a later host took over.
        if (readHolder(lockPath)?.pid === pid)
          rmSync(lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const holder = readHolder(lockPath);
    if (holder && holder.pid !== pid && alive(holder.pid)) {
      throw new StateLockedError(lockPath, holder);
    }
    // Stale (its process is gone), unreadable, or this process's own from
    // before (a host closed without releasing): taken over.
    rmSync(lockPath, { force: true });
  }
  throw new Error(`Could not take the host lock at ${lockPath}.`);
}
