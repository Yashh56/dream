// Device grants are private desktop state, deliberately outside workspace
// serialization. Electron's OS-backed encryption must be available.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function createDeviceCredentials({ file, safeStorage }) {
  const available = () => {
    if (
      !safeStorage.isEncryptionAvailable() ||
      safeStorage.getSelectedStorageBackend?.() === "basic_text"
    )
      throw new Error(
        "Unlock the OS credential store before pairing this desktop.",
      );
  };
  const read = () => {
    available();
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(file)));
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw new Error(
        "The desktop's device credentials cannot be unlocked. Restore the OS credential store or pair again.",
      );
    }
  };
  const write = (records) => {
    available();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(
      temporary,
      safeStorage.encryptString(JSON.stringify(records)),
      { mode: 0o600 },
    );
    renameSync(temporary, file);
  };
  return {
    check: () => {
      read();
    },
    put(record) {
      const records = read();
      const id = randomUUID();
      records[id] = record;
      write(records);
      return id;
    },
    get(id) {
      const record = read()[id];
      if (!record)
        throw Object.assign(
          new Error(
            "This route needs pairing again; its device credential is missing.",
          ),
          { fatal: true },
        );
      return record;
    },
    remove(id) {
      const records = read();
      delete records[id];
      write(records);
    },
  };
}
