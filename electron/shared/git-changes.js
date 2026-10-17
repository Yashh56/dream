// @ts-check
// A project's changed files as far as generated git text is concerned, on
// both sides of the route seam: which changes a commit takes, and which
// fields of a change make two sets of changes the same set.
//
// The main process caches a generated commit message by these changes (its
// fingerprint, project-git/core.js); the renderer caches what it has
// already been told by the same changes (git-generated-text.ts). Both use
// this module, so they agree on when a message is still the right one.

/**
 * @typedef {{
 *   addedLines: number,
 *   path: string,
 *   previousPath: string | null,
 *   removedLines: number,
 *   staged: boolean,
 *   status: string,
 *   unstaged: boolean,
 * }} GitChange
 */

/**
 * The changes a commit takes: the staged ones, plus the unstaged ones when
 * it includes them.
 * @template {Pick<GitChange, "staged" | "unstaged">} Change
 * @param {readonly Change[] | null | undefined} changes
 * @param {boolean} includeUnstaged
 * @returns {Change[]}
 */
export const selectCommitChanges = (changes, includeUnstaged) =>
  (changes ?? []).filter((change) =>
    includeUnstaged ? change.staged || change.unstaged : change.staged,
  );

/**
 * The fields that identify a set of changes, in path order, without anything
 * else a status entry carries.
 * @param {readonly GitChange[]} changes
 * @returns {GitChange[]}
 */
const canonicalGitChanges = (changes) =>
  changes
    .map((change) => ({
      addedLines: change.addedLines,
      path: change.path,
      previousPath: change.previousPath,
      removedLines: change.removedLines,
      staged: change.staged,
      status: change.status,
      unstaged: change.unstaged,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

/**
 * A stable text for these changes and every option that shapes what is
 * generated from them. Options are taken whole (in key order), so a new
 * option cannot be left out of the key.
 * @param {readonly GitChange[]} changes
 * @param {Record<string, unknown>} options
 * @returns {string}
 */
export const gitChangesKey = (changes, options) =>
  JSON.stringify({
    changes: canonicalGitChanges(changes),
    options: Object.fromEntries(
      Object.entries(options)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
