/**
 * The host socket, client side: one WebSocket to the host carrying every
 * kind of live traffic (electron/api/host-socket/host-socket.js). Each
 * message names its `channel`; channels register here (the terminal client,
 * the catalog events client) and this module owns the connection they share.
 *
 * The socket opens with a one-time ticket, stays open while anyone has
 * retained it, and reconnects with backoff. On every (re)connect it sends
 * one resume message with each channel's cursor, so the host resends only
 * what each channel missed. Messages sent while disconnected wait in an
 * outbox and go out after the resume. Those sent `replay: false` (terminal
 * input) wait only briefly (REPLAY_WINDOW_MS): typed just before a socket
 * opens they go out, but after an outage they are dropped rather than
 * delivered to a shell that may have moved on while the client was away.
 *
 * When the client comes back to the foreground after a while (a phone
 * unlocked, a laptop woken), a socket that still looks open may be dead:
 * it is replaced rather than trusted, and the resume brings each channel
 * up to date. A replaced socket's late messages are ignored, so an old
 * connection cannot overwrite what the new one brought.
 */
import { type ApiClient, apiClient } from "./api-client";
import { hostWebSocketUrl } from "./connections/host-endpoint";
import { connectionSupervisor } from "./connections/runtime";
import { LOCAL_HOST_ID } from "./host-routing";

export const HOST_SOCKET_PATH = "/api/host-socket";

const OUTBOX_LIMIT = 10_000;
const MIN_RETRY_MS = 250;
const MAX_RETRY_MS = 5_000;
const SOCKET_OPEN = 1;
/** Hidden this long, a socket is replaced on foregrounding, not trusted. */
export const STALE_AFTER_HIDDEN_MS = 15_000;
/** How long a message sent `replay: false` may wait for the socket. */
export const REPLAY_WINDOW_MS = 5_000;

/** The part of a browser WebSocket the client uses. */
export interface HostSocketTransport {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface HostSocketMessage {
  channel: string;
  type: string;
  [key: string]: unknown;
}

/** One kind of traffic on the socket. */
export interface HostSocketChannel {
  name: string;
  /** Where this channel stopped, sent in every resume. */
  cursor(): unknown;
  /** A message the host sent on this channel. */
  receive(message: HostSocketMessage): void;
}

export interface HostSocketSendOptions {
  /**
   * False: if the socket is not open, wait at most REPLAY_WINDOW_MS for it;
   * a message still waiting after that is dropped, not sent late.
   */
  replay?: boolean;
}

export interface HostSocketClient {
  /** Adds a channel; returns its removal. */
  register(channel: HostSocketChannel): () => void;
  /** Sends now, or after the next (re)connect's resume (see `replay`). */
  send(message: HostSocketMessage, options?: HostSocketSendOptions): void;
  /** Keeps the socket connected until the returned release is called. */
  retain(): () => void;
  /** Opens the socket now if it is closed (without retaining it). */
  connect(): void;
  /**
   * Replaces the socket with a new one now (one that may have died while
   * the client was suspended). Without anyone retaining it, just closes it.
   */
  reconnect(): void;
  /** Closes the socket for good: its connection was removed. */
  dispose(): void;
}

export interface HostSocketClientOptions {
  /** The host this socket is to; the local host when absent. */
  hostId?: string;
  api?: Pick<ApiClient, "hostSocketTicket">;
  /** Opens the socket for a ticket; the browser's WebSocket by default. */
  openSocket?: (ticket: string) => HostSocketTransport;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  now?: () => number;
}

const openSocketTo =
  (hostId: string) =>
  (ticket: string): HostSocketTransport =>
    new WebSocket(
      hostWebSocketUrl(hostId, HOST_SOCKET_PATH, { ticket }),
    ) as unknown as HostSocketTransport;

export const createHostSocketClient = ({
  hostId = LOCAL_HOST_ID,
  api = apiClient,
  openSocket = openSocketTo(hostId),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  now = () => Date.now(),
}: HostSocketClientOptions = {}): HostSocketClient => {
  const channels = new Map<string, HostSocketChannel>();
  let retained = 0;
  /** Waiting messages; `until`: when one that is not replayed expires. */
  let outbox: { text: string; until: number | null }[] = [];
  let socket: HostSocketTransport | null = null;
  let connecting = false;
  let retryDelay = MIN_RETRY_MS;
  let retryTimer: unknown = null;
  let disposed = false;

  // A host that refused this client (revoked, another host) is not asked
  // again until its connection state clears; then the socket comes back.
  const refused = () => {
    const { status } = connectionSupervisor.get(hostId);
    return status === "unauthorized" || status === "incompatible";
  };
  const stopFollowing = connectionSupervisor.subscribe(
    (changedHostId, state) => {
      if (changedHostId !== hostId) return;
      if (state.status === "ready" && retained > 0 && !socket) {
        retryDelay = MIN_RETRY_MS;
        connect();
      }
    },
  );

  const scheduleReconnect = () => {
    if (disposed || retryTimer !== null || retained === 0 || refused()) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    retryTimer = setTimer(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const receive = (text: unknown) => {
    if (typeof text !== "string") return;
    let message: HostSocketMessage;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message && typeof message.channel === "string") {
      channels.get(message.channel)?.receive(message);
    }
  };

  const open = async () => {
    let next: HostSocketTransport;
    try {
      const { ticket } = await api.hostSocketTicket({}, { hostId });
      next = openSocket(ticket);
    } catch {
      connecting = false;
      scheduleReconnect();
      return;
    }

    if (disposed) {
      next.close();
      connecting = false;
      return;
    }
    socket = next;
    next.onopen = () => {
      if (socket !== next) return;
      connecting = false;
      retryDelay = MIN_RETRY_MS;
      const cursors: Record<string, unknown> = {};
      for (const [name, channel] of channels) cursors[name] = channel.cursor();
      next.send(JSON.stringify({ channel: "host", type: "resume", cursors }));
      const time = now();
      const pending = outbox
        .filter((entry) => entry.until === null || entry.until >= time)
        .map((entry) => entry.text);
      outbox = [];
      for (const text of pending) next.send(text);
    };
    // A replaced socket's late messages would overwrite what the new
    // one's resume brought: only the current socket is heard.
    next.onmessage = (event) => {
      if (socket === next) receive(event.data);
    };
    next.onclose = () => {
      if (socket !== next) return;
      socket = null;
      connecting = false;
      scheduleReconnect();
    };
    next.onerror = () => {
      // onclose follows and schedules the reconnect.
    };
  };

  const connect = () => {
    if (disposed || socket || connecting) return;
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    connecting = true;
    void open();
  };

  const drop = () => {
    const previous = socket;
    socket = null;
    // Its handlers ignore it from here on (socket !== previous).
    previous?.close();
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
  };

  return {
    register(channel) {
      channels.set(channel.name, channel);
      return () => {
        if (channels.get(channel.name) === channel) {
          channels.delete(channel.name);
        }
      };
    },

    send(message, { replay = true } = {}) {
      const text = JSON.stringify(message);
      if (socket && socket.readyState === SOCKET_OPEN) {
        socket.send(text);
        return;
      }
      if (outbox.length < OUTBOX_LIMIT) {
        outbox.push({ text, until: replay ? null : now() + REPLAY_WINDOW_MS });
      }
      connect();
    },

    retain() {
      retained += 1;
      connect();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retained -= 1;
      };
    },

    connect,

    reconnect() {
      drop();
      retryDelay = MIN_RETRY_MS;
      // An attempt already under way opens the replacement.
      if (retained > 0) connect();
    },

    dispose() {
      disposed = true;
      stopFollowing();
      drop();
      outbox = [];
    },
  };
};

const hostSocketClients = new Map<string, HostSocketClient>();

// Back in the foreground after a while, or back online: every socket is
// replaced (it may be dead and still look open). After a short absence a
// closed one reconnects now instead of waiting out its backoff.
connectionSupervisor.onResume(({ hiddenMs, reason }) => {
  for (const client of hostSocketClients.values()) {
    if (reason === "online" || hiddenMs >= STALE_AFTER_HIDDEN_MS) {
      client.reconnect();
    } else {
      client.connect();
    }
  }
});

/**
 * Closes and forgets the socket to `hostId` (its connection was removed);
 * a later use opens a new one.
 */
export const forgetHostSocketClient = (hostId: string) => {
  hostSocketClients.get(hostId)?.dispose();
  hostSocketClients.delete(hostId);
};

/** The app's host socket to `hostId`, created on first use. */
export const getHostSocketClient = (hostId: string = LOCAL_HOST_ID) => {
  let client = hostSocketClients.get(hostId);
  if (!client) {
    client = createHostSocketClient({ hostId });
    hostSocketClients.set(hostId, client);
  }
  return client;
};

/** The app's host socket, to the local host. */
export const hostSocketClient = getHostSocketClient(LOCAL_HOST_ID);
