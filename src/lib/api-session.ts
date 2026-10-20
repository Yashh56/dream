import { getDesktopApi } from "./electron";

/**
 * The header a desktop client's requests to its local API carry the
 * per-launch token in (connections/host-endpoint.ts attaches it, to that
 * host's `/api/` paths only).
 */
export const API_SESSION_TOKEN_HEADER = "x-dream-api-token";

export function getApiSessionToken(): string | null {
  return getDesktopApi()?.apiSessionToken ?? null;
}
