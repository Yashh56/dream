// Requests for a project on another host, through this one. The renderer
// only ever talks to the local API; a request for host H goes to
// `/api/hosts/H/<route>`, and is forwarded to H's own API as `/api/<route>`
// over H's connection (an SSH port forward), carrying H's token, which
// never reaches the renderer. Streams pass through as they are (agent
// turns, raw files). The host socket is proxied as a WebSocket the same
// way; the one-time ticket in its URL is H's, issued by H through the
// forwarded ticket route, so H checks it.
import WebSocket from "ws";
import { API_SESSION_TOKEN_HEADER } from "./shared/session-token.js";

export const HOST_PROXY_PREFIX = "/api/hosts/";
const HOST_SOCKET_SUFFIX = "/host-socket";

/** Whether `path` is a proxied host socket (exempt from the token guard). */
export const isProxiedHostSocketPath = (path) =>
  path.startsWith(HOST_PROXY_PREFIX) &&
  path.endsWith(HOST_SOCKET_SUFFIX) &&
  path.slice(HOST_PROXY_PREFIX.length, -HOST_SOCKET_SUFFIX.length).length > 0 &&
  !path
    .slice(HOST_PROXY_PREFIX.length, -HOST_SOCKET_SUFFIX.length)
    .includes("/");

// Hop-by-hop headers, and what the forwarded request sets itself.
const DROPPED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  API_SESSION_TOKEN_HEADER,
]);
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
]);

const splitRoute = (path, hostId) =>
  `/api${path.slice(`${HOST_PROXY_PREFIX}${hostId}`.length)}`;

/**
 * @param {import("hono").Hono} app
 * @param {{
 *   resolveHost: (hostId: string) => { baseUrl: string, token: string } | null,
 *   upgradeWebSocket?: Function,
 *   fetchImpl?: typeof fetch,
 * }} options
 *   `resolveHost`: a connected host's forwarded endpoint, or null.
 */
export function registerHostProxyRoutes(
  app,
  { resolveHost, upgradeWebSocket, fetchImpl },
) {
  registerEndpointProxyRoutes(app, {
    fetchImpl,
    path: `${HOST_PROXY_PREFIX}:hostId/*`,
    resolveEndpoint: (c) => resolveHost(c.req.param("hostId")),
    socketPath: `${HOST_PROXY_PREFIX}:hostId${HOST_SOCKET_SUFFIX}`,
    targetPath: (c) => splitRoute(c.req.path, c.req.param("hostId")),
    upgradeWebSocket,
  });
}

/** Shared HTTP/stream and socket forwarding for SSH routes and desktop attach. */
export function registerEndpointProxyRoutes(
  app,
  {
    path,
    socketPath,
    targetPath,
    resolveEndpoint,
    upgradeWebSocket,
    fetchImpl = (...args) => fetch(...args),
  },
) {
  if (upgradeWebSocket) {
    app.get(
      socketPath,
      async (c, next) => {
        const endpoint = await resolveEndpoint(c);
        if (!endpoint) return c.text("Host is not connected.", 503);
        c.set("proxyEndpoint", endpoint);
        return next();
      },
      upgradeWebSocket((c) => {
        const endpoint = c.get("proxyEndpoint");
        const remoteUrl = `${endpoint.baseUrl.replace(/^http/, "ws")}/api${HOST_SOCKET_SUFFIX}?ticket=${encodeURIComponent(c.req.query("ticket") ?? "")}`;
        let remote = null;
        const pending = [];
        return {
          onOpen: (_event, ws) => {
            remote = new WebSocket(remoteUrl);
            remote.on("open", () => {
              for (const text of pending.splice(0)) remote.send(text);
            });
            remote.on("message", (data) => ws.send(String(data)));
            remote.on("close", () => ws.close());
            remote.on("error", () => ws.close());
            remote.on("unexpected-response", () => ws.close());
          },
          onMessage: (event) => {
            if (typeof event.data !== "string") return;
            if (remote?.readyState === WebSocket.OPEN) remote.send(event.data);
            else pending.push(event.data);
          },
          onClose: () => remote?.close(),
          onError: () => remote?.close(),
        };
      }),
    );
  }

  app.all(path, async (c) => {
    const endpoint = await resolveEndpoint(c);
    if (!endpoint) {
      return c.text("Host is not connected.", 503);
    }

    const incoming = new URL(c.req.url);
    const target = `${endpoint.baseUrl}${targetPath(c)}${incoming.search}`;
    const headers = new Headers();
    for (const [name, value] of c.req.raw.headers) {
      if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) {
        headers.set(name, value);
      }
    }
    headers.set(API_SESSION_TOKEN_HEADER, endpoint.token);

    const method = c.req.method;
    const hasBody = method !== "GET" && method !== "HEAD";
    let upstream;
    try {
      upstream = await fetchImpl(target, {
        body: hasBody ? c.req.raw.body : undefined,
        duplex: hasBody ? "half" : undefined,
        headers,
        method,
        redirect: "manual",
        // A client that goes away stops the forwarded request (a turn on the
        // host carries on regardless: it is detached there).
        signal: c.req.raw.signal,
      });
    } catch (error) {
      return c.text(
        `Host could not be reached: ${error instanceof Error ? error.message : error}`,
        502,
      );
    }

    const responseHeaders = new Headers();
    for (const [name, value] of upstream.headers) {
      if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
        responseHeaders.set(name, value);
      }
    }
    return new Response(upstream.body, {
      headers: responseHeaders,
      status: upstream.status,
      statusText: upstream.statusText,
    });
  });
}
