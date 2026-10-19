// Pairing and device sessions for a host's remote clients.
//
// The contract (CONN-02):
//
//   Pairing    A locally authorized operator (the desktop or a CLI holding
//              the host's launch token) or a device with `manage` mints a
//              pairing: the scopes it grants, a link secret and a short code.
//              It expires after PAIRING_TTL_MS and works once.
//     link     `#pair=<pairingId>.<secret>` in a URL fragment (never sent to
//              a server); the client posts it to exchange it for a session
//              and removes it from its address bar.
//     code     8 characters typed on the device with its name. That only
//              asks: an operator confirms the device by name on the host,
//              and the device, polling with the claim secret it was given,
//              then receives its session once. Code attempts are rate
//              limited host-wide.
//   Session    `dsess.<id>.<secret>`, held by the device: an HttpOnly cookie
//              for the same-origin web client, OS secure storage for native
//              ones. The host keeps only sha256(secret). A session expires
//              SESSION_IDLE_TTL_MS after it was last used; use and explicit
//              renewal extend it, and renewal never changes the credential,
//              so a healthy stream or socket is not replaced. Revocation is
//              immediate: its sockets and streams close, and nothing renews.
//   Tickets    A socket ticket is bound to the principal that asked for it,
//              and redeeming it checks again that the session is live.
//
// Pairings and claims live in memory only (they last minutes; a restart
// forgets them). Sessions are kept in the host database through the save
// queue, and in memory for checking each request.
import {
  createHash,
  randomBytes as cryptoRandomBytes,
  timingSafeEqual,
} from "node:crypto";
import { hasScope, normalizeScopes } from "./scopes.js";

export const PAIRING_TTL_MS = 10 * 60_000;
export const SESSION_IDLE_TTL_MS = 30 * 24 * 60 * 60_000;
/** How stale `lastUsedAt` may get before a use is written down. */
const TOUCH_WRITE_MS = 60 * 60_000;
/** Revoked and expired sessions stay listed this long, then are dropped. */
const RETAIN_ENDED_MS = 30 * 24 * 60 * 60_000;
const CODE_ATTEMPTS_PER_MINUTE = 10;
const SECRET_FAILURES_PER_MINUTE = 30;
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const MAX_DEVICE_NAME = 80;

/** Who is asking: this host's local operator, or a paired device. */
/**
 * @typedef {{ kind: "local", scopes: string[] }
 *   | { kind: "session", sessionId: string, scopes: string[], deviceName: string }} Principal
 */

export const LOCAL_PRINCIPAL = Object.freeze({
  kind: "local",
  scopes: Object.freeze(["view", "operate", "manage"]),
});

/** A refused pairing or session request, with its HTTP status. */
export class AuthError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest();

const sameDigest = (expectedHex, value) => {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = sha256(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

/** A cap of `limit` events per `windowMs`, host-wide. */
const createRateLimiter = ({ limit, windowMs, now }) => {
  let times = [];
  return {
    /** Records an event; false when over the cap (the event is refused). */
    take() {
      const time = now();
      times = times.filter((at) => time - at < windowMs);
      if (times.length >= limit) return false;
      times.push(time);
      return true;
    },
  };
};

const normalizeDeviceName = (value) => {
  const name =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return name.slice(0, MAX_DEVICE_NAME) || "Unnamed device";
};

/** Codes are read aloud and typed: case, dashes and look-alikes forgiven. */
export const normalizePairingCode = (value) =>
  typeof value === "string"
    ? value
        .toUpperCase()
        .replace(/[\s-]/g, "")
        .replace(/O/g, "0")
        .replace(/[IL]/g, "1")
    : "";

/** What a session looks like outside the host's own memory. */
const publicSession = (session) => ({
  clientKind: session.clientKind,
  createdAt: session.createdAt,
  deviceName: session.deviceName,
  expiresAt: session.expiresAt,
  grantedBy: session.grantedBy,
  id: session.id,
  lastUsedAt: session.lastUsedAt,
  revokedAt: session.revokedAt,
  scopes: session.scopes,
});

/**
 * @param {{
 *   getWriter: () => { writeDeviceSession: (operation: object) => Promise<unknown> },
 *   getReader: () => { read: (type: string, payload?: object) => Promise<any> },
 *   now?: () => number,
 *   randomBytes?: (size: number) => Buffer,
 * }} options
 */
export function createHostAuth({
  getWriter,
  getReader,
  now = () => Date.now(),
  randomBytes = cryptoRandomBytes,
}) {
  /** @type {Map<string, import("./session-store.js").DeviceSessionRecord>} */
  const sessions = new Map();
  /** Open sockets and streams per session, by how to close each. */
  /** @type {Map<string, Set<() => void>>} */
  const live = new Map();
  /** @type {Map<string, any>} */
  const pairings = new Map();
  /** @type {Map<string, any>} */
  const claims = new Map();
  const codeAttempts = createRateLimiter({
    limit: CODE_ATTEMPTS_PER_MINUTE,
    now,
    windowMs: 60_000,
  });
  const secretFailures = createRateLimiter({
    limit: SECRET_FAILURES_PER_MINUTE,
    now,
    windowMs: 60_000,
  });
  let loaded = null;

  const iso = (time) => new Date(time).toISOString();
  const token = (bytes) => randomBytes(bytes).toString("base64url");
  const write = (operation) => getWriter().writeDeviceSession(operation);

  const prune = () => {
    const time = now();
    for (const [id, pairing] of pairings) {
      if (pairing.expiresAt <= time) pairings.delete(id);
    }
    for (const [id, claim] of claims) {
      if (claim.expiresAt <= time) claims.delete(id);
    }
  };

  const createCode = () => {
    for (;;) {
      const bytes = randomBytes(8);
      const code = [...bytes]
        .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
        .join("");
      if (![...pairings.values()].some((pairing) => pairing.code === code)) {
        return code;
      }
    }
  };

  /** Starts a session for a device; resolves with its credential. */
  const startSession = async ({
    scopes,
    deviceName,
    clientKind,
    grantedBy,
  }) => {
    const id = randomBytes(16).toString("hex");
    const secret = token(32);
    const time = now();
    const session = {
      clientKind: clientKind === "native" ? "native" : "web",
      createdAt: iso(time),
      deviceName: normalizeDeviceName(deviceName),
      expiresAt: iso(time + SESSION_IDLE_TTL_MS),
      grantedBy,
      id,
      lastUsedAt: iso(time),
      revokedAt: null,
      scopes,
      verifier: sha256(secret).toString("hex"),
    };
    // Written before it is handed out: a credential the host would forget
    // on a restart is worse than a slower pairing.
    await write({ session, type: "save" });
    sessions.set(id, session);
    return { session: publicSession(session), token: `dsess.${id}.${secret}` };
  };

  const isLive = (session) =>
    Boolean(session) &&
    session.revokedAt === null &&
    Date.parse(session.expiresAt) > now();

  /** The pairing a link secret names, consumed; throws when there is none. */
  const takePairingBySecret = (pairingSecret) => {
    prune();
    const [pairingId, secret] =
      typeof pairingSecret === "string" ? pairingSecret.split(".") : [];
    const pairing = pairingId ? pairings.get(pairingId) : null;
    if (
      !pairing ||
      typeof secret !== "string" ||
      !sameDigest(pairing.secretVerifier, secret)
    ) {
      if (!secretFailures.take()) {
        throw new AuthError(
          "Too many pairing attempts. Try again in a minute.",
          429,
        );
      }
      throw new AuthError(
        "This pairing link is invalid, used or expired. Ask for a new one.",
      );
    }
    pairings.delete(pairing.id);
    return pairing;
  };

  /** Reads the stored sessions; every check waits for it. */
  const load = () => {
    loaded ??= (async () => {
      for (const session of await getReader().read("device-sessions")) {
        sessions.set(session.id, session);
      }
      await write({ before: iso(now() - RETAIN_ENDED_MS), type: "prune" });
    })().catch((error) => {
      loaded = null;
      throw error;
    });
    return loaded;
  };

  return {
    load,

    /**
     * Mints a pairing granting `scopes`. Only the local operator or a
     * manager may; a pairing never grants more than its creator holds.
     * @param {Principal} principal
     * @param {{ scopes?: unknown, deviceName?: unknown }} request
     */
    createPairing(principal, { scopes, deviceName } = {}) {
      if (!hasScope(principal.scopes, "manage")) {
        throw new AuthError("Only a manager can pair devices.", 403);
      }
      const granted = normalizeScopes(scopes ?? "operate").filter((scope) =>
        principal.scopes.includes(scope),
      );
      if (granted.length === 0) {
        throw new AuthError("A pairing needs at least one scope.", 400);
      }
      prune();
      const id = randomBytes(12).toString("hex");
      const secret = token(32);
      const expiresAt = now() + PAIRING_TTL_MS;
      const code = createCode();
      pairings.set(id, {
        code,
        createdBy: principal.kind === "local" ? "local" : principal.sessionId,
        deviceName:
          typeof deviceName === "string" && deviceName.trim()
            ? normalizeDeviceName(deviceName)
            : null,
        expiresAt,
        id,
        scopes: granted,
        secretVerifier: sha256(secret).toString("hex"),
      });
      return {
        code: `${code.slice(0, 4)}-${code.slice(4)}`,
        expiresAt: iso(expiresAt),
        /** Goes after `#` in a pairing URL, never in its path or query. */
        fragment: `pair=${id}.${secret}`,
        pairingId: id,
        scopes: granted,
      };
    },

    /**
     * Exchanges a pairing link's secret for a session. Works once.
     * @param {{ pairingSecret: unknown, deviceName?: unknown, clientKind?: unknown }} request
     */
    async exchangePairing({ pairingSecret, deviceName, clientKind }) {
      await load();
      const pairing = takePairingBySecret(pairingSecret);
      return startSession({
        clientKind,
        deviceName: deviceName ?? pairing.deviceName,
        grantedBy: pairing.createdBy,
        scopes: pairing.scopes,
      });
    },

    /**
     * Asks to pair with a short code. Grants nothing yet: an operator has
     * to confirm the device by name. Resolves with what the device polls
     * with.
     * @param {{ code: unknown, deviceName?: unknown, clientKind?: unknown }} request
     */
    claimPairingCode({ code, deviceName, clientKind }) {
      if (!codeAttempts.take()) {
        throw new AuthError(
          "Too many pairing attempts. Try again in a minute.",
          429,
        );
      }
      prune();
      const normalized = normalizePairingCode(code);
      const pairing = [...pairings.values()].find(
        (candidate) => normalized && candidate.code === normalized,
      );
      if (!pairing) {
        throw new AuthError("This pairing code is invalid, used or expired.");
      }
      pairings.delete(pairing.id);
      const id = randomBytes(12).toString("hex");
      const secret = token(32);
      claims.set(id, {
        clientKind: clientKind === "native" ? "native" : "web",
        createdAt: iso(now()),
        deviceName: normalizeDeviceName(deviceName ?? pairing.deviceName),
        expiresAt: pairing.expiresAt,
        id,
        pairing,
        result: null,
        secretVerifier: sha256(secret).toString("hex"),
        state: "pending",
      });
      return {
        claimId: id,
        claimSecret: secret,
        expiresAt: iso(pairing.expiresAt),
      };
    },

    /** Code claims waiting for an operator, for it to confirm or deny. */
    listClaims(principal) {
      if (!hasScope(principal.scopes, "manage")) {
        throw new AuthError("Only a manager can see pairing requests.", 403);
      }
      prune();
      return [...claims.values()]
        .filter((claim) => claim.state === "pending")
        .map((claim) => ({
          claimId: claim.id,
          clientKind: claim.clientKind,
          createdAt: claim.createdAt,
          deviceName: claim.deviceName,
          expiresAt: iso(claim.expiresAt),
          scopes: claim.pairing.scopes,
        }));
    },

    /**
     * An operator's answer to a code claim: confirmed, the device's next
     * poll receives its session; denied, it never does.
     * @param {Principal} principal
     * @param {{ claimId: unknown, approve: boolean }} answer
     */
    async answerClaim(principal, { claimId, approve }) {
      if (!hasScope(principal.scopes, "manage")) {
        throw new AuthError("Only a manager can confirm devices.", 403);
      }
      await load();
      prune();
      const claim = typeof claimId === "string" ? claims.get(claimId) : null;
      if (!claim || claim.state !== "pending") {
        throw new AuthError("That pairing request is no longer waiting.", 404);
      }
      if (!approve) {
        claim.state = "denied";
        return { approved: false };
      }
      claim.state = "confirmed";
      claim.result = await startSession({
        clientKind: claim.clientKind,
        deviceName: claim.deviceName,
        grantedBy: principal.kind === "local" ? "local" : principal.sessionId,
        scopes: claim.pairing.scopes,
      });
      return { approved: true, session: claim.result.session };
    },

    /**
     * A device polling its code claim. The session is handed over once.
     * @param {{ claimId: unknown, claimSecret: unknown }} request
     */
    pollClaim({ claimId, claimSecret }) {
      prune();
      const claim = typeof claimId === "string" ? claims.get(claimId) : null;
      if (
        !claim ||
        typeof claimSecret !== "string" ||
        !sameDigest(claim.secretVerifier, claimSecret)
      ) {
        if (!secretFailures.take()) {
          throw new AuthError(
            "Too many pairing attempts. Try again in a minute.",
            429,
          );
        }
        throw new AuthError("This pairing request is invalid or expired.");
      }
      if (claim.state === "pending") return { status: "pending" };
      claims.delete(claim.id);
      if (claim.state === "denied") {
        throw new AuthError("This device was not confirmed on the host.", 403);
      }
      return { status: "confirmed", ...claim.result };
    },

    /**
     * The principal a session credential stands for, or null. A use more
     * than an hour after the last recorded one extends the session.
     * @param {unknown} credential
     * @returns {Promise<Principal | null>}
     */
    async authenticate(credential) {
      if (typeof credential !== "string") return null;
      const [prefix, id, secret, ...rest] = credential.split(".");
      if (prefix !== "dsess" || !id || !secret || rest.length > 0) return null;
      await load();
      const session = sessions.get(id);
      if (!isLive(session) || !sameDigest(session.verifier, secret))
        return null;
      const time = now();
      if (time - Date.parse(session.lastUsedAt) >= TOUCH_WRITE_MS) {
        session.lastUsedAt = iso(time);
        session.expiresAt = iso(time + SESSION_IDLE_TTL_MS);
        void write({
          expiresAt: session.expiresAt,
          id,
          lastUsedAt: session.lastUsedAt,
          type: "touch",
        }).catch(() => undefined);
      }
      return {
        deviceName: session.deviceName,
        kind: "session",
        scopes: session.scopes,
        sessionId: id,
      };
    },

    /** Whether a principal may still act (its session not revoked or expired). */
    isActive: (/** @type {Principal} */ principal) =>
      principal.kind === "local" || isLive(sessions.get(principal.sessionId)),

    /**
     * Extends a live session from now. The credential stays the same.
     * @param {Principal} principal
     */
    async renew(principal) {
      const session =
        principal.kind === "session" ? sessions.get(principal.sessionId) : null;
      if (!isLive(session)) throw new AuthError("This session has ended.");
      const time = now();
      session.lastUsedAt = iso(time);
      session.expiresAt = iso(time + SESSION_IDLE_TTL_MS);
      await write({
        expiresAt: session.expiresAt,
        id: session.id,
        lastUsedAt: session.lastUsedAt,
        type: "touch",
      });
      return publicSession(session);
    },

    /** One session, as its device may see it. */
    describe(/** @type {Principal} */ principal) {
      return principal.kind === "session"
        ? publicSession(sessions.get(principal.sessionId))
        : { kind: "local", scopes: principal.scopes };
    },

    /** Every session, live or recently ended, for a manager. */
    async listSessions(/** @type {Principal} */ principal) {
      if (!hasScope(principal.scopes, "manage")) {
        throw new AuthError("Only a manager can list devices.", 403);
      }
      await load();
      return [...sessions.values()].map(publicSession);
    },

    /**
     * Ends a session at once: its sockets and streams close, and it can
     * neither be used nor renewed again. A device may end its own session;
     * only a manager may end another's.
     * @param {Principal} principal
     * @param {string} sessionId
     */
    async revoke(principal, sessionId) {
      const own =
        principal.kind === "session" && principal.sessionId === sessionId;
      if (!own && !hasScope(principal.scopes, "manage")) {
        throw new AuthError("Only a manager can revoke other devices.", 403);
      }
      await load();
      const session = sessions.get(sessionId);
      if (!session) throw new AuthError("No such device session.", 404);
      if (session.revokedAt !== null) return publicSession(session);
      session.revokedAt = iso(now());
      for (const close of live.get(sessionId) ?? []) {
        try {
          close();
        } catch {
          // Already closing.
        }
      }
      live.delete(sessionId);
      await write({
        id: sessionId,
        revokedAt: session.revokedAt,
        type: "revoke",
      });
      return publicSession(session);
    },

    /**
     * Registers how to close something a session holds open (a socket, a
     * streamed response), so revoking it closes them. Returns the undo.
     * @param {Principal} principal
     * @param {() => void} close
     */
    track(principal, close) {
      if (principal.kind !== "session") return () => {};
      let set = live.get(principal.sessionId);
      if (!set) {
        set = new Set();
        live.set(principal.sessionId, set);
      }
      set.add(close);
      return () => {
        set.delete(close);
        if (set.size === 0 && live.get(principal.sessionId) === set) {
          live.delete(principal.sessionId);
        }
      };
    },
  };
}
