// A host's remote access: whether paired devices can reach it, and how.
// The host owns it (not a client's workspace), so the desktop's local host
// and a daemon behave the same, and it is applied again when the host
// starts.
//
//   remote-access.json beside dream.db, or <database>.remote-access.json   0600
//     enabled      whether to serve paired devices at all
//     mode         "tailscale" (Tailscale Serve terminates HTTPS) or
//                  "origin" (an HTTPS reverse proxy the user runs)
//     port         the listener's loopback port, picked once and kept so a
//                  proxy's configuration stays valid across restarts
//     httpsPort    Tailscale's HTTPS port (443 by default)
//     origin       the reverse proxy's public origin (mode "origin")
//     servedBy     the Tailscale Serve entry Dream created, so turning
//                  access off removes exactly that and nothing else
//
// A public address is reported ready only after a request through it
// reached this host (its descriptor's host id matched): no address that
// does not work is shown as one that does. The listener itself stays on
// loopback; reaching it still requires pairing.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import getPort from "get-port";
import { TailscaleProblem } from "./tailscale.js";

const SETTINGS_FILE = "remote-access.json";
const VERIFY_TIMEOUT_MS = 8_000;

const DEFAULTS = Object.freeze({
  enabled: false,
  httpsPort: 443,
  mode: "tailscale",
  origin: null,
  port: null,
  servedBy: null,
  version: 1,
});

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validPort = (value) =>
  Number.isInteger(value) && value > 0 && value < 65_536 ? value : null;

/** An https origin (scheme, host, port only), or null. */
export const httpsOrigin = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
};

const readSettings = (file) => {
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ...DEFAULTS };
  }
  if (!isRecord(raw)) return { ...DEFAULTS };
  return {
    enabled: raw.enabled === true,
    httpsPort: validPort(raw.httpsPort) ?? DEFAULTS.httpsPort,
    mode: raw.mode === "origin" ? "origin" : "tailscale",
    origin: httpsOrigin(raw.origin),
    port: validPort(raw.port),
    servedBy:
      isRecord(raw.servedBy) &&
      validPort(raw.servedBy.httpsPort) &&
      validPort(raw.servedBy.localPort)
        ? {
            httpsPort: raw.servedBy.httpsPort,
            localPort: raw.servedBy.localPort,
          }
        : null,
    version: 1,
  };
};

const writeSettings = (file, settings) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, file);
};

/** A problem the user can act on: { code, message, url }. */
const asProblem = (error) =>
  error instanceof TailscaleProblem
    ? { code: error.code, message: error.message, url: error.url ?? null }
    : {
        code: "failed",
        message: error instanceof Error ? error.message : String(error),
        url: null,
      };

/**
 * @param {{
 *   dataDirectory: string,
 *   settingsFile?: string,
 *   hostId: () => string,
 *   listen: (options: { port: number, publicOrigins: string[], trustForwardedHost: boolean }) => Promise<{ port: number, origins: string[] }>,
 *   close: () => Promise<void>,
 *   tailscale: ReturnType<typeof import("./tailscale.js").createTailscale>,
 *   fetchImpl?: typeof fetch,
 *   pickPort?: () => Promise<number>,
 *   now?: () => string,
 * }} options
 *   `listen` / `close`: the host's remote listener (index.js).
 */
export function createRemoteAccess({
  dataDirectory,
  settingsFile = path.join(dataDirectory, SETTINGS_FILE),
  hostId,
  listen,
  close,
  tailscale,
  fetchImpl = (...args) => fetch(...args),
  pickPort = () => getPort({ host: "127.0.0.1" }),
  now = () => new Date().toISOString(),
}) {
  const file = settingsFile;
  let settings = readSettings(file);
  let listening = null; // { port }
  let origin = null; // the verified public origin
  let problem = null;
  let checkedAt = null;
  // One change at a time: enable, disable and refresh never interleave.
  let queue = Promise.resolve();
  const serially = (work) => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const save = (patch) => {
    settings = { ...settings, ...patch };
    writeSettings(file, settings);
  };

  const status = () => ({
    checkedAt,
    enabled: settings.enabled,
    httpsPort: settings.httpsPort,
    listening: listening !== null,
    mode: settings.mode,
    // Only an address verified to reach this host.
    origin,
    port: listening?.port ?? settings.port,
    problem,
    ready: settings.enabled && listening !== null && origin !== null,
    requestedOrigin: settings.mode === "origin" ? settings.origin : null,
  });

  /** Whether `candidate` reaches this host: its descriptor names it. */
  const verify = async (candidate) => {
    try {
      const response = await fetchImpl(`${candidate}/api/remote/descriptor`, {
        redirect: "error",
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (!response.ok) {
        return `${candidate} answered ${response.status}, not this host.`;
      }
      const descriptor = await response.json();
      return descriptor?.hostId === hostId()
        ? null
        : `${candidate} reaches a different Dream host.`;
    } catch (error) {
      return `${candidate} did not answer from this computer (${error instanceof Error ? error.message : error}).`;
    }
  };

  const stopListening = async () => {
    if (!listening) return;
    listening = null;
    await close();
  };

  /** Starts (or restarts) the listener for `publicOrigin`. */
  const startListening = async (publicOrigin) => {
    await stopListening();
    let port = settings.port;
    if (!port) {
      port = await pickPort();
      save({ port });
    }
    try {
      const started = await listen({
        port,
        publicOrigins: publicOrigin ? [publicOrigin] : [],
        // Both fronts are reverse proxies on this machine that may name the
        // public host in X-Forwarded-Host.
        trustForwardedHost: true,
      });
      listening = { port: started.port };
      return started.port;
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        throw Object.assign(
          new Error(
            `Port ${port} on this computer is already in use. Choose another port for remote access.`,
          ),
          { problemCode: "port-in-use" },
        );
      }
      throw error;
    }
  };

  /** Brings the saved settings into effect. */
  const apply = async () => {
    checkedAt = now();
    origin = null;
    problem = null;
    if (!settings.enabled) {
      await stopListening();
      return status();
    }
    try {
      let candidate;
      if (settings.mode === "origin") {
        if (!settings.origin) {
          throw Object.assign(
            new Error("Enter the HTTPS address your reverse proxy serves."),
            { problemCode: "needs-origin" },
          );
        }
        // Tailscale is not the way in now: the Serve entry Dream made goes.
        if (settings.servedBy) {
          await tailscale.disable(settings.servedBy);
          save({ servedBy: null });
        }
        await startListening(settings.origin);
        candidate = settings.origin;
      } else {
        // The device's name first: it is the origin the listener accepts.
        const device = await tailscale.device();
        candidate =
          settings.httpsPort === 443
            ? `https://${device.dnsName}`
            : `https://${device.dnsName}:${settings.httpsPort}`;
        const port = await startListening(candidate);
        // A Serve entry Dream made for another port is Dream's to remove.
        if (
          settings.servedBy &&
          (settings.servedBy.httpsPort !== settings.httpsPort ||
            settings.servedBy.localPort !== port)
        ) {
          await tailscale.disable(settings.servedBy).catch(() => false);
          save({ servedBy: null });
        }
        await tailscale.enable({
          httpsPort: settings.httpsPort,
          localPort: port,
        });
        save({ servedBy: { httpsPort: settings.httpsPort, localPort: port } });
      }
      const unreachable = await verify(candidate);
      if (unreachable) {
        problem = {
          code: "unreachable",
          message:
            settings.mode === "origin"
              ? `${unreachable} Check that your reverse proxy forwards to 127.0.0.1:${listening?.port}.`
              : `${unreachable} Tailscale may still be provisioning the certificate; check again in a minute.`,
          url: null,
        };
      } else {
        origin = candidate;
      }
    } catch (error) {
      problem = error?.problemCode
        ? { code: error.problemCode, message: error.message, url: null }
        : asProblem(error);
    }
    return status();
  };

  return {
    status,

    /** Applies the saved settings (at startup). */
    start: () => serially(apply),

    /** Checks again (after the user fixed a setup step). */
    refresh: () => serially(apply),

    /**
     * Turns remote access on with these settings.
     * @param {{ mode?: "tailscale" | "origin", origin?: string, httpsPort?: number, port?: number | null }} options
     */
    enable: (options = {}) =>
      serially(async () => {
        const mode =
          options.mode === "origin"
            ? "origin"
            : options.mode === "tailscale"
              ? "tailscale"
              : settings.mode;
        const requestedOrigin =
          options.origin === undefined
            ? settings.origin
            : httpsOrigin(options.origin);
        if (
          mode === "origin" &&
          options.origin !== undefined &&
          !requestedOrigin
        ) {
          problem = {
            code: "needs-origin",
            message:
              "The address must be an https:// origin, such as https://dream.example.com.",
            url: null,
          };
          return status();
        }
        save({
          enabled: true,
          httpsPort: validPort(options.httpsPort) ?? settings.httpsPort,
          mode,
          origin: requestedOrigin,
          port:
            options.port === null
              ? null
              : (validPort(options.port) ?? settings.port),
        });
        return apply();
      }),

    /**
     * Turns remote access off: the listener stops (paired devices can no
     * longer reach it) and the Serve entry Dream made is removed. Local
     * work, and paired devices' sessions, are untouched.
     */
    disable: () =>
      serially(async () => {
        save({ enabled: false });
        await stopListening();
        origin = null;
        problem = null;
        checkedAt = now();
        if (settings.servedBy) {
          try {
            await tailscale.disable(settings.servedBy);
            save({ servedBy: null });
          } catch (error) {
            // The listener is already closed, so nothing is reachable; the
            // leftover entry is reported, and removed on the next attempt.
            problem = asProblem(error);
          }
        }
        return status();
      }),

    /** Stops listening (the host is closing); settings stay as they are. */
    close: () => serially(stopListening),
  };
}
