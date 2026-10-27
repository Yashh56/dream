// A user-private cloudflared runtime, falling back to an installed CLI. Installation
// downloads an official release and verifies GitHub's SHA256 asset digest.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const exec = promisify(execFile);
const RELEASES =
  "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";
// The first release with `tunnel run --token-file`.
const MIN_VERSION = "2025.4.0";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const problem = (message) =>
  Object.assign(new Error(message), { problemCode: "cloudflared-install" });

const supported = (version) => {
  const parts = version.split(".").map(Number);
  const minimum = MIN_VERSION.split(".").map(Number);
  for (const [index, part] of minimum.entries())
    if (parts[index] !== part) return parts[index] > part;
  return true;
};

/** Extract just one regular executable, never paths, symlinks or tar metadata. */
const unpackMacBinary = (packed) => {
  const tar = gunzipSync(packed, { maxOutputLength: 100 * 1024 * 1024 });
  let binary = null;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/, "");
    const sizeText = header
      .subarray(124, 136)
      .toString()
      .replace(/\0.*$/, "")
      .trim();
    if (!/^[0-7]+$/.test(sizeText))
      throw problem("Invalid cloudflared archive size.");
    const size = Number.parseInt(sizeText, 8);
    if (
      name !== "cloudflared" ||
      prefix ||
      ![0, 48].includes(header[156]) ||
      binary ||
      size <= 0 ||
      offset + 512 + size > tar.length
    )
      throw problem("The cloudflared archive contains unexpected entries.");
    binary = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!binary) throw problem("The cloudflared archive contains no executable.");
  return binary;
};

const readBounded = async (response, limit) => {
  if (!response.ok)
    throw problem(
      `Cloudflare release download failed (${response.status}). Try again or install cloudflared manually.`,
    );
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit)
      throw problem(
        "Cloudflare's release response exceeded the download limit.",
      );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export function createCloudflaredRuntime({
  directory,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = (...args) => fetch(...args),
  run = exec,
}) {
  let installing = null;
  // The managed binary's last verified digest, keyed by its file metadata, so
  // each connector restart does not read and hash the whole executable again.
  let verified = null;
  const recordFile = path.join(directory, "runtime.json");
  const binaryName = platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const matchesRecord = (executable, sha256) => {
    const { size, mtimeMs } = statSync(executable);
    if (
      verified?.executable === executable &&
      verified.sha256 === sha256 &&
      verified.size === size &&
      verified.mtimeMs === mtimeMs
    )
      return true;
    if (digest(readFileSync(executable)) !== sha256) return false;
    verified = { executable, sha256, size, mtimeMs };
    return true;
  };
  /** Removes earlier runtimes and failed stages, keeping `keep`. */
  const removeStages = (keep) => {
    let entries = [];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.startsWith("runtime-") || entry === keep) continue;
      try {
        rmSync(path.join(directory, entry), { recursive: true, force: true });
      } catch {
        /* Still running (Windows locks it); removed after the next install. */
      }
    }
  };
  const inspect = async (executable) => {
    const result = await run(executable, ["--version"], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 16_384,
    });
    const version = String(result.stdout).match(
      /cloudflared version (\d+\.\d+\.\d+)/,
    )?.[1];
    if (!version || !supported(version))
      throw problem(
        `cloudflared ${MIN_VERSION} or newer is required. Install a current version.`,
      );
    return { executable, version, installed: true };
  };
  const detect = async () => {
    const candidates = [];
    try {
      const record = JSON.parse(readFileSync(recordFile, "utf8"));
      if (
        typeof record.directory === "string" &&
        /^[A-Za-z0-9._-]+$/.test(record.directory)
      ) {
        const executable = path.join(directory, record.directory, binaryName);
        if (existsSync(executable) && matchesRecord(executable, record.sha256))
          candidates.push(executable);
      }
    } catch {
      /* No managed runtime yet; try PATH and installer locations. */
    }
    candidates.push("cloudflared");
    if (platform === "darwin")
      candidates.push(
        "/opt/homebrew/bin/cloudflared",
        "/usr/local/bin/cloudflared",
      );
    if (platform === "win32")
      candidates.push(
        path.join(
          process.env.ProgramFiles ?? "C:\\Program Files",
          "cloudflared",
          "cloudflared.exe",
        ),
      );
    for (const executable of candidates) {
      try {
        return await inspect(executable);
      } catch {
        /* Try the next candidate. */
      }
    }
    return { installed: false, executable: null, version: null };
  };
  const install = () => {
    if (installing) return installing;
    installing = (async () => {
      const architecture = { x64: "amd64", arm64: "arm64" }[arch];
      const os = { darwin: "darwin", linux: "linux", win32: "windows" }[
        platform
      ];
      if (!architecture || !os)
        throw problem(
          `Automatic cloudflared installation is unavailable on ${platform}/${arch}. Install it manually.`,
        );
      const name = `cloudflared-${os}-${architecture}${platform === "darwin" ? ".tgz" : platform === "win32" ? ".exe" : ""}`;
      const release = JSON.parse(
        (
          await readBounded(
            await fetchImpl(RELEASES, {
              signal: AbortSignal.timeout(20_000),
              headers: { accept: "application/vnd.github+json" },
            }),
            2 * 1024 * 1024,
          )
        ).toString(),
      );
      const asset = release.assets?.find((item) => item.name === name);
      if (
        !/^\d+\.\d+\.\d+$/.test(release.tag_name) ||
        !supported(release.tag_name) ||
        !asset ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")
      )
        throw problem(
          "A verified cloudflared release is unavailable for this platform. Install cloudflared manually.",
        );
      const url = `https://github.com/cloudflare/cloudflared/releases/download/${release.tag_name}/${name}`;
      if (asset.browser_download_url !== url)
        throw problem("Unexpected Cloudflare release URL.");
      const packed = await readBounded(
        await fetchImpl(url, { signal: AbortSignal.timeout(120_000) }),
        100 * 1024 * 1024,
      );
      if (`sha256:${digest(packed)}` !== asset.digest)
        throw problem(
          "cloudflared checksum mismatch. The current runtime was not changed.",
        );
      const bytes = platform === "darwin" ? unpackMacBinary(packed) : packed;
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const stage = mkdtempSync(path.join(directory, "runtime-"));
      const temporary = `${recordFile}.${process.pid}.tmp`;
      let published = false;
      try {
        const executable = path.join(stage, binaryName);
        writeFileSync(executable, bytes, { mode: 0o700 });
        if (platform !== "win32") chmodSync(executable, 0o700);
        const found = await inspect(executable);
        if (found.version !== release.tag_name)
          throw problem(
            "The cloudflared executable does not match its release.",
          );
        writeFileSync(
          temporary,
          JSON.stringify({
            directory: path.basename(stage),
            sha256: digest(bytes),
            version: found.version,
          }),
          { mode: 0o600 },
        );
        renameSync(temporary, recordFile);
        published = true;
        return found;
      } finally {
        if (published) removeStages(path.basename(stage));
        else
          try {
            rmSync(temporary, { force: true });
            rmSync(stage, { recursive: true, force: true });
          } catch {
            /* Keep the original error; the next install removes the stage. */
          }
      }
    })().finally(() => {
      installing = null;
    });
    return installing;
  };
  return { detect, install };
}
