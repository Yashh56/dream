// A project file's path as the Files panel names it: relative to the project
// folder, with forward slashes. Agents and links name files every which way
// (absolute, `./`-prefixed, Windows separators, a drive letter in another
// case); this is the one place those become the panel's form.

const toSlashes = (value: string) => value.replace(/\\/g, "/");

const hasWindowsDrive = (value: string) => /^[a-z]:\//i.test(value);

const isAbsolute = (value: string) =>
  value.startsWith("/") || hasWindowsDrive(value);

/** Windows paths compare case-insensitively; POSIX paths exactly. */
const comparable = (value: string) =>
  hasWindowsDrive(value) ? value.toLowerCase() : value;

/**
 * `rawPath` relative to `projectPath`, or null when it names the project
 * folder itself or anything outside it.
 */
export const resolveProjectFilePath = (
  projectPath: string,
  rawPath: string,
): string | null => {
  const root = toSlashes(projectPath.trim()).replace(/\/+$/, "");
  const path = toSlashes(rawPath.trim());
  if (!root || !path) {
    return null;
  }

  let relative: string;
  if (isAbsolute(path)) {
    const prefix = `${comparable(root)}/`;
    if (!comparable(path).startsWith(prefix)) {
      return null;
    }
    relative = path.slice(prefix.length);
  } else {
    relative = path.replace(/^(\.\/)+/, "");
  }

  const segments = relative.split("/").filter((segment) => segment !== "");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  return segments.join("/");
};
