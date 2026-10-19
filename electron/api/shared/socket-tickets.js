// One-time tickets for WebSocket upgrades. A browser WebSocket cannot send
// the API token header, so a client first asks for a ticket over a guarded
// JSON route and then opens the socket with `?ticket=`. A ticket works once
// and expires quickly, so a long-lived token never appears in a URL. Each
// is bound to the principal that asked for it (the local operator, or a
// paired device's session), which the socket then acts as.
import { randomBytes } from "node:crypto";

export const SOCKET_TICKET_TTL_MS = 30_000;

export function createSocketTickets({
  ttlMs = SOCKET_TICKET_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const tickets = new Map();

  const prune = () => {
    const time = now();
    for (const [ticket, { expiresAt }] of tickets) {
      if (expiresAt <= time) tickets.delete(ticket);
    }
  };

  return {
    /**
     * A ticket for `principal` (whatever the caller authenticated as).
     * @param {object} principal
     */
    issue(principal) {
      prune();
      const ticket = randomBytes(24).toString("hex");
      tickets.set(ticket, { expiresAt: now() + ttlMs, principal });
      return ticket;
    },

    /**
     * The principal of a live ticket, once; null for unknown, used or
     * expired. Whether that principal may still act is the caller's check.
     */
    redeem(ticket) {
      if (typeof ticket !== "string" || !tickets.has(ticket)) return null;
      const { expiresAt, principal } = tickets.get(ticket);
      tickets.delete(ticket);
      return expiresAt > now() ? principal : null;
    },
  };
}
