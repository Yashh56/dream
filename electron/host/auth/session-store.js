// Device sessions in the host's state database: written by the save queue's
// worker (persisted-state-worker.js), read once when the host starts. A row
// holds a verifier of the session's secret, never the secret.

/**
 * @typedef {object} DeviceSessionRecord
 * @property {string} id
 * @property {string} deviceName
 * @property {"web" | "native"} clientKind
 * @property {string[]} scopes
 * @property {string} verifier sha256 of the secret, hex
 * @property {string} grantedBy `local`, or the id of the session that paired it
 * @property {string} createdAt
 * @property {string} lastUsedAt
 * @property {string} expiresAt
 * @property {string | null} revokedAt
 */

const fromRow = (row) => ({
  clientKind: row.client_kind === "native" ? "native" : "web",
  createdAt: row.created_at,
  deviceName: row.device_name,
  expiresAt: row.expires_at,
  grantedBy: row.granted_by,
  id: row.id,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at ?? null,
  scopes: JSON.parse(row.scopes),
  verifier: row.verifier,
});

/**
 * Every session not yet expired or revoked long ago (revoked and expired
 * rows are kept a while, so the device list can say what happened).
 * @returns {DeviceSessionRecord[]}
 */
export const readDeviceSessions = (database) =>
  database
    .prepare("SELECT * FROM device_sessions ORDER BY created_at")
    .all()
    .map(fromRow);

/**
 * One write to the sessions table:
 *   { type: "save", session }        insert or replace a session
 *   { type: "touch", id, lastUsedAt, expiresAt }
 *   { type: "revoke", id, revokedAt }
 *   { type: "prune", before }        drop rows expired or revoked before
 * @returns {boolean} whether a row changed
 */
export function writeDeviceSession(database, operation) {
  switch (operation?.type) {
    case "save": {
      const session = /** @type {DeviceSessionRecord} */ (operation.session);
      database
        .prepare(
          `INSERT INTO device_sessions
             (id, device_name, client_kind, scopes, verifier, granted_by,
              created_at, last_used_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             device_name = excluded.device_name,
             scopes = excluded.scopes,
             last_used_at = excluded.last_used_at,
             expires_at = excluded.expires_at,
             revoked_at = excluded.revoked_at`,
        )
        .run(
          session.id,
          session.deviceName,
          session.clientKind,
          JSON.stringify(session.scopes),
          session.verifier,
          session.grantedBy,
          session.createdAt,
          session.lastUsedAt,
          session.expiresAt,
          session.revokedAt ?? null,
        );
      return true;
    }
    case "touch":
      return (
        database
          .prepare(
            "UPDATE device_sessions SET last_used_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL",
          )
          .run(operation.lastUsedAt, operation.expiresAt, operation.id)
          .changes > 0
      );
    case "revoke":
      return (
        database
          .prepare(
            "UPDATE device_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
          )
          .run(operation.revokedAt, operation.id).changes > 0
      );
    case "prune":
      return (
        database
          .prepare(
            "DELETE FROM device_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)",
          )
          .run(operation.before, operation.before).changes > 0
      );
    default:
      throw new Error(`Unknown device session write: ${operation?.type}`);
  }
}
