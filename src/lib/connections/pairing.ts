/**
 * Pairing a browser client with the host that serves its page
 * (electron/host/auth/host-auth.js has the contract). The session it gets
 * is an HttpOnly cookie this page never sees; once it is set, the page
 * starts over with it.
 *
 *   link   `/pair#pair=<id>.<secret>`: the fragment is read and removed
 *          from the address bar before anything is sent, then exchanged.
 *   code   the device asks with the short code and its name; someone on
 *          the host confirms that name; the device's poll then receives
 *          the session once.
 */
import { LOCAL_HOST_ID } from "../host-routing";
import { hostFetch } from "./host-endpoint";

const PAIR_FRAGMENT = /(?:^|&)pair=([^&]+)/;

/**
 * The pairing secret in this page's address, removed from it (so it is in
 * neither history nor a later copy of the URL), or null.
 */
export const takePairingFromLocation = (): string | null => {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.slice(1).match(PAIR_FRAGMENT);
  if (!match) return null;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/** A name for this device the host's operator will recognise. */
export const describeThisDevice = (): string => {
  if (typeof navigator === "undefined") return "Browser";
  const agent = navigator.userAgent;
  const device = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Mac OS X/.test(agent)
          ? "Mac"
          : /Windows/.test(agent)
            ? "Windows"
            : /Linux/.test(agent)
              ? "Linux"
              : "Device";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  return `${device} · ${browser}`;
};

/** The host's refusal, as it worded it. */
export class PairingError extends Error {
  override name = "PairingError";
}

const post = async <T>(path: string, body: object): Promise<T> => {
  const response = await hostFetch(LOCAL_HOST_ID, path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    const reason = (await response.text().catch(() => "")).trim();
    throw new PairingError(reason || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
};

/** Exchanges a pairing link's secret for this browser's session cookie. */
export const pairWithLink = (pairing: string, deviceName: string) =>
  post<{ session: unknown }>("/api/remote/pair", {
    clientKind: "web",
    deviceName,
    pairing,
  });

export interface PairingClaim {
  claimId: string;
  claimSecret: string;
  expiresAt: string;
}

/** Asks to pair with a short code; nothing is granted until confirmed. */
export const requestPairingWithCode = (code: string, deviceName: string) =>
  post<PairingClaim>("/api/remote/pair/code", {
    clientKind: "web",
    code: code.trim(),
    deviceName,
  });

/**
 * Whether the claim was confirmed yet. `confirmed` means the session cookie
 * is now set; a denied or expired claim rejects with the host's reason.
 */
export const pollPairingClaim = async ({
  claimId,
  claimSecret,
}: PairingClaim): Promise<"pending" | "confirmed"> => {
  const { status } = await post<{ status: string }>("/api/remote/pair/claim", {
    claimId,
    claimSecret,
  });
  return status === "confirmed" ? "confirmed" : "pending";
};

/** Starts the page over with the new session (from the app's root). */
export const restartPaired = () => {
  window.location.replace("/");
};
