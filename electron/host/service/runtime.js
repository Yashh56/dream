// Verified, immutable-by-convention service runtimes. These are separate from
// SSH's versions directory, whose pruning must never remove a service binary.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { downloadRuntimeArchive } from "../../ssh/host-install.js";
import { assertRuntimeCompatible } from "../runtime-contract.js";

const exec = promisify(execFile);
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

const runtimePaths = (root) => ({
  entry: path.join(root, "lib", "dream-host.js"),
  program: path.join(
    root,
    "node",
    process.platform === "win32" ? "node.exe" : "node",
  ),
});

export async function inspectRuntime(launch) {
  const { stdout } = await exec(launch.program, [launch.args[0], "version"], {
    env: { ...process.env, ...launch.environment },
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  const info = JSON.parse(stdout.trim());
  if (!info.version || !info.runtime)
    throw new Error(
      "The installed binary has no service-update contract. Install a current packaged runtime first.",
    );
  assertRuntimeCompatible(info.runtime, info.runtime);
  return info;
}

export const launchFromRuntime = (root, previous) => {
  const { program, entry } = runtimePaths(root);
  const environment = { ...previous.environment };
  delete environment.ELECTRON_RUN_AS_NODE;
  return {
    ...previous,
    args: [entry, ...previous.args.slice(1)],
    environment,
    program,
  };
};

/** Keep a packaged runtime even if its original SSH installation is pruned. */
export async function retainRuntime(home, launch, expected) {
  const root = path.dirname(path.dirname(launch.args[0]));
  const paths = runtimePaths(root);
  if (
    !existsSync(path.join(root, "VERSION")) ||
    !existsSync(paths.program) ||
    !existsSync(paths.entry) ||
    realpathSync(launch.program) !== realpathSync(paths.program) ||
    realpathSync(launch.args[0]) !== realpathSync(paths.entry)
  ) {
    throw new Error(
      "Service updates require a packaged host runtime. Build or download one and run its `service install` command with the existing data directory and environment first.",
    );
  }
  const directory = path.join(home, "service-runtimes");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(path.dirname(root)) === realpathSync(directory))
    return launch;
  const retained = path.join(directory, `previous-${randomUUID()}`);
  cpSync(root, retained, { recursive: true, dereference: true });
  const next = launchFromRuntime(retained, launch);
  const info = await inspectRuntime(next);
  if (JSON.stringify(info) !== JSON.stringify(expected))
    throw new Error(
      "The installed runtime changed while it was being retained. Retry the update.",
    );
  return next;
}

export async function stageRuntime({
  home,
  version,
  archive,
  sha256,
  previous,
  expectedRuntime,
}) {
  if (!VERSION.test(version ?? "") || version.length > 100)
    throw new Error(
      "Specify a release version, for example `service update 0.31.0`.",
    );
  if (
    Boolean(archive) !== Boolean(sha256) ||
    (sha256 && !/^[a-f0-9]{64}$/i.test(sha256))
  ) {
    throw new Error(
      "An offline --archive requires its --sha256 (64 hexadecimal characters).",
    );
  }
  const directory = path.join(home, "service-runtimes");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(path.join(directory, ".stage-"));
  try {
    let source = archive;
    let expected = sha256?.toLowerCase();
    if (!source) {
      const download = await downloadRuntimeArchive({
        arch: process.arch,
        cacheDirectory: path.join(stage, "download"),
        fetchImpl: async (url) => {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(120_000),
          });
          if (response.status === 404)
            throw new Error(
              `No published service runtime for ${version} on ${process.platform}-${process.arch}. Choose a published version or supply --archive and --sha256.`,
            );
          return response;
        },
        os: process.platform === "win32" ? "windows" : process.platform,
        version,
      });
      source = download.archivePath;
      expected = readFileSync(download.sumsPath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .find(
          ([, name]) => name === download.name || name === `*${download.name}`,
        )?.[0];
    }
    // Verify the private copy, so an offline archive cannot change mid-extract.
    const packed = path.join(stage, "runtime.tar.gz");
    copyFileSync(source, packed);
    const digest = createHash("sha256")
      .update(readFileSync(packed))
      .digest("hex");
    if (digest !== expected)
      throw new Error(
        "Host runtime checksum mismatch; the service was not changed.",
      );
    const options = {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    };
    const listing = await exec("tar", ["-tzf", packed], options);
    const names = listing.stdout.trim().split(/\r?\n/);
    if (
      names.some(
        (name) =>
          !name ||
          name.startsWith("/") ||
          /[\\:]/.test(name) ||
          [...name].some((character) => character.charCodeAt(0) < 32) ||
          name.split("/").includes(".."),
      )
    ) {
      throw new Error("The runtime archive contains an unsafe path.");
    }
    const details = await exec("tar", ["-tvzf", packed], options);
    if (
      details.stdout
        .trim()
        .split(/\r?\n/)
        .some((line) => !/^[-d]/.test(line))
    ) {
      throw new Error(
        "The runtime archive must contain only regular files and directories.",
      );
    }
    const unpacked = path.join(stage, "runtime");
    mkdirSync(unpacked);
    await exec("tar", ["-xzf", packed, "-C", unpacked], options);
    const launch = launchFromRuntime(unpacked, previous);
    const info = await inspectRuntime(launch);
    assertRuntimeCompatible(expectedRuntime, info.runtime);
    if (
      info.version !== version ||
      readFileSync(path.join(unpacked, "VERSION"), "utf8").trim() !== version
    ) {
      throw new Error(
        "The archive does not contain the requested host version.",
      );
    }
    const target = path.join(directory, `${version}-${randomUUID()}`);
    renameSync(unpacked, target);
    return { info, launch: launchFromRuntime(target, previous) };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
