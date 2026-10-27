// Owns only cloudflared children launched by this host. It never installs an
// OS-wide cloudflared service, kills another connector, or changes cloud DNS.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import getPort from "get-port";
import { stopChildProcess } from "../../process-tree.js";
import { createCloudflaredRuntime } from "./cloudflared-runtime.js";

export function createCloudflareConnector({
  directory,
  runtime = createCloudflaredRuntime({
    directory: path.join(directory, "runtime"),
  }),
  spawnProcess = spawn,
  stopProcess = stopChildProcess,
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  pickPort = () => getPort({ host: "127.0.0.1" }),
}) {
  const tokenFile = path.join(directory, "tunnel-token");
  const configFile = path.join(directory, "config.yml");
  let info = { installed: false, version: null, executable: null };
  let child = null,
    runningKey = null,
    metricsPort = null,
    failures = 0,
    timer = null,
    generation = 0,
    desired = false,
    // Needs the operator (rejected token, missing token or runtime): no retry.
    blocked = false,
    startedAt = 0,
    healthyAt = 0;
  let state = "idle",
    error = null,
    retryAt = null;
  let operations = Promise.resolve();
  const serial = (work) => {
    const run = operations.then(work, work);
    operations = run.catch(() => {});
    return run;
  };
  const snapshot = () => ({
    installed: info.installed,
    version: info.version,
    tokenSaved: existsSync(tokenFile),
    state,
    error,
    retryAt,
  });
  const clearWake = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    retryAt = null;
  };
  const stopChild = async () => {
    const closing = child;
    child = null;
    runningKey = null;
    metricsPort = null;
    await stopProcess(closing);
  };
  const writeToken = (value) => {
    const token = value.trim();
    if (!/^[A-Za-z0-9+/=_-]{20,16384}$/.test(token))
      throw Object.assign(
        new Error(
          "Paste only the Cloudflare tunnel token, not the installation command.",
        ),
        { problemCode: "cloudflare-token" },
      );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${tokenFile}.${process.pid}.tmp`;
    writeFileSync(temporary, token, { mode: 0o600 });
    renameSync(temporary, tokenFile);
  };
  const block = (message) => {
    clearWake();
    blocked = true;
    state = "failed";
    error = message;
  };
  // Backoff is bounded, the retries are not: an unattended host must come
  // back after a long network outage without anyone choosing Check again.
  const schedule = () => {
    clearWake();
    if (!desired || blocked) return;
    state = "reconnecting";
    if (failures >= 5)
      error =
        "The Cloudflare connector keeps stopping. Retrying every minute; check the network, firewall and tunnel configuration.";
    const delay = Math.min(60_000, 2_000 * 2 ** Math.max(0, failures - 1));
    retryAt = now() + delay;
    timer = setTimer(() => {
      timer = null;
      retryAt = null;
      void serial(() => launch()).catch(() => {});
    }, delay);
    timer.unref?.();
  };
  const launch = async () => {
    if (!desired || child || blocked) return snapshot();
    const epoch = generation;
    try {
      info = await runtime.detect();
    } catch {
      info = { installed: false, version: null, executable: null };
    }
    if (!info.installed) {
      block(
        "cloudflared is missing or too old. Choose Install cloudflared, then Check again.",
      );
      return snapshot();
    }
    if (!existsSync(tokenFile)) {
      block("Save the Cloudflare tunnel token, then choose Check again.");
      return snapshot();
    }
    try {
      const token = readFileSync(tokenFile, "utf8");
      const key = createHash("sha256").update(token).digest("hex");
      const port = await pickPort();
      if (!desired || epoch !== generation) return snapshot();
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      // Ignore global/user cloudflared config and inherited tunnel flags.
      writeFileSync(configFile, "{}\n", { mode: 0o600 });
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) =>
          /^(PATH|HOME|USER|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|PROGRAMFILES|PROGRAMFILES\(X86\)|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR)$/i.test(
            name,
          ),
        ),
      );
      const next = spawnProcess(
        process.execPath,
        [
          fileURLToPath(new URL("./cloudflared-runner.js", import.meta.url)),
          info.executable,
          "tunnel",
          "--config",
          configFile,
          "--no-autoupdate",
          "--metrics",
          `127.0.0.1:${port}`,
          "--loglevel",
          "error",
          "--retries",
          "5",
          "run",
          "--token-file",
          tokenFile,
        ],
        {
          env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      child = next;
      metricsPort = port;
      runningKey = key;
      startedAt = now();
      healthyAt = 0;
      state = "starting";
      error = null;
      let authFailed = false;
      let buffer = "";
      // Raw connector logs never leave this module: they may contain tokens.
      next.stderr?.on("data", (chunk) => {
        buffer = (buffer + String(chunk)).slice(-8192);
        if (
          /invalid tunnel secret|unauthorized|invalid token|provided tunnel token is not valid|authentication failed/i.test(
            buffer,
          )
        )
          authFailed = true;
      });
      let settled = false;
      const ended = () => {
        if (settled) return;
        settled = true;
        if (child !== next || epoch !== generation) return;
        child = null;
        runningKey = null;
        metricsPort = null;
        if (authFailed) {
          block(
            "Cloudflare rejected the tunnel token. Replace it with a current token from Cloudflare.",
          );
          return;
        }
        failures += 1;
        error =
          "The Cloudflare connector exited. Checking the connection again.";
        schedule();
      };
      next.once("error", ended);
      next.once("exit", ended);
      return snapshot();
    } catch {
      // A transient local failure (a port, a file); retried with backoff.
      if (epoch === generation) {
        failures += 1;
        error =
          "The Cloudflare connector could not start. Retrying; check its saved token and runtime installation.";
        schedule();
      }
      return snapshot();
    }
  };
  /** Replaces the running connector (or the pending retry) with a fresh one. */
  const relaunch = async () => {
    generation += 1;
    clearWake();
    await stopChild();
    failures = 0;
    blocked = false;
    state = "idle";
    error = null;
    return launch();
  };
  return {
    status: snapshot,
    detect: () =>
      serial(async () => {
        info = await runtime.detect();
        return snapshot();
      }),
    install: () =>
      serial(async () => {
        const next = await runtime.install();
        const replace = child && next.executable !== info.executable;
        info = next;
        if (!desired) return snapshot();
        if (replace || !child) return relaunch();
        return snapshot();
      }),
    configure: ({ token } = {}) =>
      serial(async () => {
        if (token?.trim()) {
          writeToken(token);
          const key = createHash("sha256")
            .update(readFileSync(tokenFile))
            .digest("hex");
          if (key !== runningKey) {
            // Stop the connector running the old token; the next start uses this one.
            generation += 1;
            clearWake();
            await stopChild();
            failures = 0;
            blocked = false;
          }
        }
        return snapshot();
      }),
    start: ({ retry = false } = {}) =>
      serial(async () => {
        desired = true;
        if (retry) {
          failures = 0;
          blocked = false;
          clearWake();
        }
        if (!child && !timer) return launch();
        return snapshot();
      }),
    /** Stops the owned connector and starts it again, if it should run. */
    restart: () => serial(() => (desired ? relaunch() : snapshot())),
    async check() {
      const active = child,
        epoch = generation,
        port = metricsPort;
      if (!active || !port) return snapshot();
      try {
        const response = await fetchImpl(`http://127.0.0.1:${port}/ready`, {
          redirect: "error",
          signal: AbortSignal.timeout(3000),
        });
        await response.body?.cancel();
        if (child !== active || epoch !== generation) return snapshot();
        if (response.ok) {
          state = "connected";
          error = null;
          healthyAt = now();
          if (healthyAt - startedAt >= 60_000) failures = 0;
        } else {
          state = "reconnecting";
          error =
            "Cloudflare is not connected yet. Check network access to Cloudflare on port 7844.";
        }
      } catch {
        if (child === active && epoch === generation) {
          state = "reconnecting";
          error =
            "Waiting for the Cloudflare connector to establish a connection.";
        }
      }
      // Unhealthy for two minutes since it started or was last connected;
      // cloudflared reconnects on its own before that.
      if (
        child === active &&
        state !== "connected" &&
        now() - Math.max(startedAt, healthyAt) > 120_000
      )
        await serial(async () => {
          if (child !== active || epoch !== generation) return;
          generation += 1;
          await stopChild();
          failures += 1;
          schedule();
        });
      return snapshot();
    },
    stop: () => {
      desired = false;
      generation += 1;
      clearWake();
      return serial(async () => {
        await stopChild();
        failures = 0;
        blocked = false;
        state = "idle";
        error = null;
        return snapshot();
      });
    },
  };
}
