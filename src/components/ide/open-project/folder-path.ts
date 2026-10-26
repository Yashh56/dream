/**
 * Typing a folder path on a host, with the folders that could come next:
 * the text is split at its last separator into the folder to list and the
 * start of a name in it. Pure, so the dialog only renders the result.
 */
import type { HostDirectoryEntry } from "@/lib/api-client";

/** What a new path starts as: the host's home. */
export const HOME_FOLDER_INPUT = "~/";

/** The characters that end a folder name on a host with `separator`. */
const isSeparator = (char: string, separator: string) =>
  char === "/" || (separator === "\\" && char === "\\");

/**
 * `input` split at its last separator: `parent` keeps the separator (it is
 * what a completion is appended to), `prefix` is the name being typed.
 */
export const splitFolderInput = (input: string, separator: string) => {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    if (isSeparator(input[index] ?? "", separator)) {
      return {
        parent: input.slice(0, index + 1),
        prefix: input.slice(index + 1),
      };
    }
  }
  return { parent: "", prefix: input };
};

/**
 * The folder to list for `parent`, in the form `/api/host-directories`
 * takes: home when nothing is typed yet, so a bare name completes in home.
 */
export const folderToList = (parent: string) => parent || HOME_FOLDER_INPUT;

/**
 * The folders whose names start with `prefix`, ignoring case. Hidden ones
 * appear only once the prefix asks for them with a leading dot.
 */
export const matchFolders = (
  directories: readonly HostDirectoryEntry[],
  prefix: string,
) => {
  const lowered = prefix.toLocaleLowerCase();
  const showHidden = prefix.startsWith(".");
  return directories.filter(
    (entry) =>
      (showHidden || !entry.hidden) &&
      entry.name.toLocaleLowerCase().startsWith(lowered),
  );
};

/**
 * The text after completing `name` in `parent`: the folder itself, ending
 * in a separator so its own folders are listed next. A name typed with no
 * folder before it is in home.
 */
export const completeFolder = (
  parent: string,
  name: string,
  separator: string,
) => `${parent || HOME_FOLDER_INPUT}${name}${separator}`;
