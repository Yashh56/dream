// Desktop attachment to an installed host service. The desktop keeps its
// workspace, SSH connections and browser; the service keeps all execution.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { serveApp } from "./api/app.js";
import { registerBrowserToolCallRoutes } from "./api/browser-tool-call-routes.js";
import {
  isProxiedHostSocketPath,
  registerEndpointProxyRoutes,
  registerHostProxyRoutes,
} from "./api/host-proxy-routes.js";
import { HOST_SOCKET_PATH } from "./api/host-socket-routes.js";
import { API_SESSION_TOKEN_HEADER } from "./api/shared/session-token.js";
import { probeDaemon } from "./host/daemon.js";
import { HOST_IDENTITY_FILE, loadHostIdentity } from "./host/identity.js";
import { HOST_PROTOCOL_VERSION, hostProtocolProblem } from "./host/protocol.js";
import { getRunDirectory, readHostRecord } from "./host/run-directory.js";
import {
  createServiceManager,
  readInstalledServiceName,
} from "./host/service/service.js";

/** Only the owner of this desktop's database and identity may be its home host. */
export function createServiceHostAttachment({
  home,
  dataDirectory,
  stateDatabasePath,
  resolveRemoteHost,
  env = process.env,
  createManager = createServiceManager,
}) {
  const runDirectory = getRunDirectory(home, HOST_PROTOCOL_VERSION);
  let identity = null;
  let verified = null;
  let checking = null;
  let server = null;

  const verify = async () => {
    // Read the record every time: a restart can change both port and token.
    const record = readHostRecord(runDirectory);
    if (!record)
      throw new Error(
        "The host service is unavailable; run `dream-host service status`.",
      );
    const key = JSON.stringify(record);
    if (verified?.key === key) return verified.endpoint;
    if (checking?.key === key) return checking.promise;
    const promise = (async () => {
      const running = await probeDaemon(runDirectory);
      if (!running || JSON.stringify(running) !== key) {
        throw new Error(
          "The host service did not answer; run `dream-host service status`.",
        );
      }
      let holder;
      try {
        holder = JSON.parse(
          readFileSync(`${stateDatabasePath}.host-lock`, "utf8"),
        );
      } catch {
        throw new Error(
          "The service does not own this desktop's state database. Check its --data-dir and DREAM_DB_PATH configuration.",
        );
      }
      if (holder.pid !== running.pid) {
        throw new Error(
          "The service uses a different state database. Install it with this desktop's data directory and DREAM_DB_PATH before attaching.",
        );
      }
      if (!existsSync(path.join(dataDirectory, HOST_IDENTITY_FILE))) {
        throw new Error(
          "The desktop's host identity is missing. Attach to the service using the original desktop data directory.",
        );
      }
      // Pin before awaiting the descriptor: concurrent requests during a
      // restart must all compare against the same local identity.
      identity ??= loadHostIdentity(dataDirectory);
      const expected = identity;
      const endpoint = {
        baseUrl: `http://127.0.0.1:${running.port}`,
        token: running.token,
      };
      const response = await fetch(`${endpoint.baseUrl}/api/host-info`, {
        headers: { [API_SESSION_TOKEN_HEADER]: endpoint.token },
        redirect: "error",
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) throw new Error("The host service refused attachment.");
      const info = await response.json();
      const problem = hostProtocolProblem(info.hostProtocolVersion);
      if (problem) throw new Error(problem);
      if (!info.capabilities?.includes("terminal-discovery")) {
        throw new Error(
          "Update and restart the host service before attaching this desktop; the service does not support terminal discovery.",
        );
      }
      if (
        info.pid !== running.pid ||
        info.hostId !== expected.hostId ||
        info.fingerprint !== expected.fingerprint ||
        info.publicKey !== expected.publicKey
      ) {
        throw new Error(
          "The service is a different host. Restore the original host data and identity before attaching.",
        );
      }
      identity = expected;
      verified = { endpoint, key };
      return endpoint;
    })();
    checking = { key, promise };
    try {
      return await promise;
    } finally {
      if (checking?.promise === promise) checking = null;
    }
  };

  return {
    // Unloading the desktop owns no service processes to stop.
    processSessions: {
      hasActiveSessions: () => false,
      stopAllProcesses: async () => {},
    },
    startRemoteAccess: async () => {},
    async listen({ apiToken, port }) {
      if (server) throw new Error("The desktop edge is already listening.");
      const name = readInstalledServiceName(home);
      if (!name)
        throw new Error(
          "Service mode needs an installed host service. Run `dream-host service install` with the desktop's data directory first.",
        );
      const manager = createManager({ env, home, name });
      if (!manager.isInstalled() || !manager.servesHome(home)) {
        throw new Error("The installed service does not serve this host home.");
      }
      if (!(await probeDaemon(runDirectory))) {
        await manager.start();
        const deadline = Date.now() + 20_000;
        while (!(await probeDaemon(runDirectory)) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      await verify();
      const app = new Hono();
      app.onError((error, c) => c.text(error.message, 503));
      app.use("/api/*", async (c, next) => {
        if (
          c.req.path !== HOST_SOCKET_PATH &&
          !isProxiedHostSocketPath(c.req.path) &&
          c.req.header(API_SESSION_TOKEN_HEADER) !== apiToken
        ) {
          return c.text("Unauthorized", 401);
        }
        return next();
      });
      // These calls must execute in the process that owns the browser.
      registerBrowserToolCallRoutes(app);
      registerHostProxyRoutes(app, {
        resolveHost: resolveRemoteHost,
        upgradeWebSocket,
      });
      // Stopping the shared host is a separate operator action.
      app.post("/api/host/shutdown", (c) =>
        c.text("Use `dream-host service stop` to stop the service.", 409),
      );
      registerEndpointProxyRoutes(app, {
        path: "/api/*",
        resolveEndpoint: verify,
        socketPath: HOST_SOCKET_PATH,
        targetPath: (c) => c.req.path,
        upgradeWebSocket,
      });
      server = await serveApp(app, { hostname: "127.0.0.1", port });
      return server.port;
    },
    async close() {
      const closing = server;
      server = null;
      await closing?.close();
    },
  };
}
