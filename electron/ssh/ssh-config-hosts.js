// @ts-check
// The host aliases in the user's ssh config, offered as suggestions when an
// SSH host is added. Only names to type after `ssh`: ssh itself still reads
// the config when it connects, so nothing else here is interpreted.
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Includes followed at most this deep (ssh's own limit is 16). */
const MAX_INCLUDE_DEPTH = 8;
/** Aliases returned at most. */
export const SSH_CONFIG_HOST_LIMIT = 200;

/** A `Host` pattern that names one host, not a set of them. */
const isAlias = (/** @type {string} */ pattern) => !/[*?!]/.test(pattern);

/**
 * The words of one config line: `Keyword value...` or `Keyword=value`,
 * with double-quoted words kept whole. Comments and blank lines give none.
 * @param {string} line
 */
const words = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return [];
  const result = [];
  const pattern = /"([^"]*)"|([^\s=]+)/g;
  for (const match of trimmed.matchAll(pattern)) {
    result.push(match[1] ?? match[2] ?? "");
  }
  return result;
};

/**
 * The aliases and Include patterns in one config file's text.
 * @param {string} text
 */
export const parseSshConfig = (text) => {
  /** @type {string[]} */
  const hosts = [];
  /** @type {string[]} */
  const includes = [];
  for (const line of text.split(/\r?\n/)) {
    const [keyword, ...values] = words(line);
    switch (keyword?.toLowerCase()) {
      case "host":
        hosts.push(...values.filter(isAlias));
        break;
      case "include":
        includes.push(...values);
        break;
    }
  }
  return { hosts, includes };
};

/**
 * The files an Include pattern names: `~` expanded, relative to `~/.ssh`,
 * and a `*` or `?` in the last part matched against that folder.
 * @param {string} pattern
 * @param {{ home: string, list: (folder: string) => Promise<string[]> }} options
 */
const includedFiles = async (pattern, { home, list }) => {
  const expanded = pattern.startsWith("~/")
    ? path.join(home, pattern.slice(2))
    : path.resolve(home, ".ssh", pattern);
  const name = path.basename(expanded);
  if (!/[*?]/.test(name)) return [expanded];
  const folder = path.dirname(expanded);
  const matcher = new RegExp(
    `^${name
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  );
  const names = await list(folder).catch(() => []);
  return names
    .filter((entry) => matcher.test(entry))
    .sort()
    .map((entry) => path.join(folder, entry));
};

/**
 * The aliases in `~/.ssh/config` and the files it includes, in the order
 * they appear, each once. A missing or unreadable file gives none.
 * @param {{ home?: string, read?: (file: string) => Promise<string>, list?: (folder: string) => Promise<string[]> }} [options]
 * @returns {Promise<string[]>}
 */
export async function readSshConfigHosts({
  home = os.homedir(),
  read = (file) => readFile(file, "utf8"),
  list = (folder) => readdir(folder),
} = {}) {
  /** @type {Set<string>} */
  const hosts = new Set();
  /** @type {Set<string>} */
  const visited = new Set();

  /** @param {string} file @param {number} depth */
  const visit = async (file, depth) => {
    if (depth > MAX_INCLUDE_DEPTH || visited.has(file)) return;
    visited.add(file);
    const text = await read(file).catch(() => null);
    if (text === null) return;
    const parsed = parseSshConfig(text);
    for (const host of parsed.hosts) hosts.add(host);
    for (const pattern of parsed.includes) {
      for (const included of await includedFiles(pattern, { home, list })) {
        await visit(included, depth + 1);
      }
    }
  };

  await visit(path.join(home, ".ssh", "config"), 0);
  return [...hosts].slice(0, SSH_CONFIG_HOST_LIMIT);
}
