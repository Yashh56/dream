// Who a host is, independent of how a client reaches it. One identity per
// host data directory: an id and an Ed25519 key pair, created the first
// time a host starts there and kept across restarts, runtime upgrades and
// changes of address. Clients key their saved connections by the id; the
// public key's fingerprint is what a route that cannot vouch for the host
// by itself (a URL, rather than an SSH session) will verify a signature
// against. An id alone proves nothing: anyone can repeat it.
//
//   <data directory>/host-identity.json   0600
//
// The file is published whole or not at all, and never replaced: two hosts
// starting at once on one directory end with the same identity, and an
// unreadable file is an error rather than a quietly new host.
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";

export const HOST_IDENTITY_FILE = "host-identity.json";
const IDENTITY_FORMAT = 1;
/** How long a reader waits for a file another host is still writing. */
const PARTIAL_READ_RETRY_MS = 50;
const PARTIAL_READ_ATTEMPTS = 40;

/**
 * @typedef {object} HostIdentity
 * @property {string} hostId the host's persistent id
 * @property {string} publicKey SPKI DER, base64
 * @property {string} fingerprint `SHA256:` and the public key's digest, base64
 * @property {string} createdAt
 */

/** `SHA256:<base64>` of a public key's SPKI DER, as ssh prints keys. */
export const fingerprintOf = (/** @type {Buffer} */ spkiDer) =>
  `SHA256:${createHash("sha256").update(spkiDer).digest("base64").replace(/=+$/, "")}`;

const sleepSync = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

class UnreadableIdentityError extends Error {
  constructor(file, reason) {
    super(
      `The host identity in ${file} cannot be read (${reason}). Restore the file, or delete it to give this host a new identity; clients that saved this host will then treat it as a different host.`,
    );
    this.name = "UnreadableIdentityError";
  }
}

/**
 * The identity a file holds. Its fingerprint is recomputed from the key, so
 * an edited fingerprint cannot disagree with the key it names.
 * @returns {HostIdentity}
 */
const parseIdentity = (file, text) => {
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    throw new UnreadableIdentityError(file, "not JSON");
  }
  if (
    record?.format !== IDENTITY_FORMAT ||
    typeof record.hostId !== "string" ||
    !record.hostId ||
    typeof record.publicKey !== "string" ||
    typeof record.privateKey !== "string"
  ) {
    throw new UnreadableIdentityError(file, "unexpected contents");
  }
  let spki;
  try {
    spki = createPublicKey(record.privateKey).export({
      format: "der",
      type: "spki",
    });
  } catch {
    throw new UnreadableIdentityError(file, "invalid key");
  }
  if (spki.toString("base64") !== record.publicKey) {
    throw new UnreadableIdentityError(file, "the keys do not match");
  }
  return {
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    fingerprint: fingerprintOf(spki),
    hostId: record.hostId,
    publicKey: record.publicKey,
  };
};

const createRecord = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    createdAt: new Date().toISOString(),
    format: IDENTITY_FORMAT,
    hostId: `host_${randomUUID()}`,
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKey: publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
  };
};

/**
 * Publishes `text` as `file` unless it exists. A hard link of a complete
 * temporary file makes it appear whole; where links are not supported, an
 * exclusive create (a reader that catches it half-written retries).
 * @returns {boolean} whether this call published it
 */
const publishOnce = (file, text) => {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  try {
    linkSync(temporary, file);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    if (
      !["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"].includes(
        error?.code,
      )
    ) {
      throw error;
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // Already gone.
    }
  }
  let descriptor;
  try {
    descriptor = openSync(file, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(descriptor, text);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return true;
};

/** The file's identity, waiting briefly for one another host is writing. */
const readPublished = (file) => {
  for (let attempt = 1; ; attempt += 1) {
    const text = readFileSync(file, "utf8");
    try {
      return parseIdentity(file, text);
    } catch (error) {
      // Only an exclusive create can be caught half-written.
      if (attempt >= PARTIAL_READ_ATTEMPTS || text.trim().endsWith("}")) {
        throw error;
      }
      sleepSync(PARTIAL_READ_RETRY_MS);
    }
  }
};

/**
 * The identity of the host whose data lives in `dataDirectory`, created
 * there the first time.
 * @param {string} dataDirectory
 * @returns {HostIdentity}
 */
export function loadHostIdentity(dataDirectory) {
  const file = path.join(path.resolve(dataDirectory), HOST_IDENTITY_FILE);
  try {
    return readPublished(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const record = createRecord();
  publishOnce(file, `${JSON.stringify(record)}\n`);
  // Whoever won, the file is the identity.
  return readPublished(file);
}
