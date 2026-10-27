// All service mutations share this lock, including ensure/desktop starts.
// A directory with a PID-named file lets stale contenders remove only the
// dead owner's file. An empty directory is refused, never stolen mid-create.
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isProcessAlive } from "../run-directory.js";

export function writeServiceJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = openSync(temporary, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
  if (process.platform !== "win32") {
    const directory = openSync(path.dirname(file), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
}

export function acquireServiceOperation(home) {
  const directory = path.join(home, "service-operation.lock");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owners = readdirSync(directory);
      const pid = owners.length === 1 ? Number(owners[0]) : null;
      if (!pid || !Number.isInteger(pid) || isProcessAlive(pid)) {
        throw new Error(
          `Another service operation is running (${directory}). If its launcher died before recording its PID, remove the empty lock directory and retry.`,
        );
      }
      try {
        unlinkSync(path.join(directory, String(pid)));
        rmdirSync(directory);
      } catch {
        // A concurrent recovery owns the next attempt.
      }
      continue;
    }
    const owner = path.join(directory, String(process.pid));
    writeFileSync(owner, "", { flag: "wx", mode: 0o600 });
    return () => {
      unlinkSync(owner);
      rmdirSync(directory);
    };
  }
  throw new Error(
    "Another service operation is recovering the lock. Retry shortly.",
  );
}
