// The IPC channel closes even when the host is killed abruptly. Keep this
// small watchdog alive long enough to reap its connector on parent loss.
import { spawn } from "node:child_process";
import { stopChildProcess } from "../../process-tree.js";

const [executable, ...args] = process.argv.slice(2);
const child = spawn(executable, args, {
  windowsHide: true,
  stdio: ["ignore", "ignore", "pipe"],
});
child.stderr.pipe(process.stderr);
process.stderr.on("error", () => {});
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await stopChildProcess(child);
  process.exit(0);
};
process.on("disconnect", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
child.once("error", () => {
  process.stderr.write("cloudflared could not start.\n");
  process.exit(1);
});
child.once("exit", (code) => {
  if (!stopping) process.exit(code ?? 1);
});
if (!process.connected) void stop();
