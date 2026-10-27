// The runtime's update contract. Migration hashes are deliberately exact:
// unattended updates must leave a database the previous binary can still use.
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { HOST_CAPABILITIES, HOST_PROTOCOL_VERSION } from "./protocol.js";

// Bump for incompatible persisted JSON/queue/session semantics, even when no
// SQL migration changes. Such a release needs a coordinated data upgrade.
const HOST_STORAGE_FORMAT_VERSION = 1;

/* global __DREAM_HOST_VERSION__ */
export function runtimeContract() {
  const migrationsFolder = fileURLToPath(
    new URL(
      typeof __DREAM_HOST_VERSION__ === "string" ? "./drizzle/" : "../drizzle/",
      import.meta.url,
    ),
  );
  return {
    arch: process.arch,
    capabilities: HOST_CAPABILITIES,
    hostProtocolVersion: HOST_PROTOCOL_VERSION,
    migrations: readMigrationFiles({ migrationsFolder }).map((migration) => ({
      hash: migration.hash,
      when: migration.folderMillis,
    })),
    platform: process.platform,
    storageFormatVersion: HOST_STORAGE_FORMAT_VERSION,
  };
}

export function assertRuntimeCompatible(previous, next) {
  if (
    !previous?.migrations?.length ||
    !next?.migrations?.length ||
    !Array.isArray(previous.capabilities) ||
    !Array.isArray(next.capabilities)
  ) {
    throw new Error(
      "This runtime has no update contract. Install a runtime with service-update support first.",
    );
  }
  if (
    next.platform !== process.platform ||
    next.arch !== process.arch ||
    next.hostProtocolVersion !== HOST_PROTOCOL_VERSION ||
    previous.platform !== next.platform ||
    previous.arch !== next.arch ||
    previous.hostProtocolVersion !== next.hostProtocolVersion ||
    previous.storageFormatVersion !== HOST_STORAGE_FORMAT_VERSION ||
    next.storageFormatVersion !== previous.storageFormatVersion ||
    !previous.capabilities.every((capability) =>
      next.capabilities.includes(capability),
    ) ||
    !HOST_CAPABILITIES.every((capability) =>
      next.capabilities.includes(capability),
    )
  ) {
    throw new Error(
      "The runtime's platform, protocol, storage format or capabilities are incompatible with this service.",
    );
  }
  if (JSON.stringify(previous.migrations) !== JSON.stringify(next.migrations)) {
    throw new Error(
      "The runtime changes database migrations. Automatic replacement cannot guarantee rollback; keep this service and use a coordinated, backed-up upgrade.",
    );
  }
}
