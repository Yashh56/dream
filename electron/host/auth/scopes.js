// What a paired device may do on a host. A ladder, each scope including the
// ones below it:
//
//   view      read projects, chats, transcripts, files, diffs and terminal
//             output; follow live changes
//   operate   act as the user: submit and stop chats, answer approvals,
//             write files, run git writes, start and type into terminals
//   manage    change the host itself (agent CLIs, skills, MCP imports) and
//             its remote access: pair, list and revoke devices
//
// Pairing grants control of the host under its OS user; scopes keep a
// view-only device from mutating and keep device management with managers.
// Pure: shared by the host's route policy and its clients.

export const SCOPES = Object.freeze(["view", "operate", "manage"]);

/** @typedef {"view" | "operate" | "manage"} Scope */

/**
 * `scopes`, cleaned and with everything they imply, lowest first; empty
 * when none is valid.
 * @param {unknown} scopes
 * @returns {Scope[]}
 */
export const normalizeScopes = (scopes) => {
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const top = Math.max(
    -1,
    ...list.map((scope) => SCOPES.indexOf(/** @type {Scope} */ (scope))),
  );
  return /** @type {Scope[]} */ (SCOPES.slice(0, top + 1));
};

/**
 * Whether a grant of `scopes` allows what `required` names.
 * @param {readonly string[]} scopes
 * @param {Scope} required
 */
export const hasScope = (scopes, required) => scopes.includes(required);
