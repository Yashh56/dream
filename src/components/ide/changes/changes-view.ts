/**
 * What the Changes tab shows of a project's changed files, beyond the git
 * status itself: which files are expanded, which large diffs the user chose
 * to render anyway, which files are being reverted, and which are hidden
 * because a revert of them is under way or just finished.
 *
 * A reverted file is hidden at once. If the revert fails it shows again; if
 * it succeeds it stays hidden until a git status read after the revert
 * arrives, which decides: gone, or (the revert did not take) shown again.
 * Pure; the panel dispatches what happened and renders the result.
 */

export interface ChangesViewState {
  expanded: readonly string[];
  /** Large diffs rendered anyway, past the size guard. */
  forced: readonly string[];
  reverting: readonly string[];
  /**
   * Hidden after a revert, by path: null while the revert runs; once it
   * succeeded, the git version a status must be read at to show it again.
   */
  hidden: Readonly<Record<string, number | null>>;
}

export type ChangesViewAction =
  | { type: "toggle"; path: string }
  | { type: "expand-all"; paths: readonly string[] }
  | { type: "collapse-all" }
  | { type: "force-render"; path: string }
  | { type: "revert-started"; paths: readonly string[] }
  | {
      type: "revert-finished";
      paths: readonly string[];
      succeeded: boolean;
      /** The project's git version after the revert. */
      version: number;
    }
  /** A git status read at `version` (and current) reports `paths` changed. */
  | { type: "status"; paths: readonly string[]; version: number };

export const EMPTY_CHANGES_VIEW: ChangesViewState = {
  expanded: [],
  forced: [],
  hidden: {},
  reverting: [],
};

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => right[index] === value);

/** `state` with only the fields that changed replaced, else `state`. */
const withChanges = (
  state: ChangesViewState,
  next: Partial<ChangesViewState>,
): ChangesViewState => {
  const changed =
    (next.expanded && !sameList(next.expanded, state.expanded)) ||
    (next.forced && !sameList(next.forced, state.forced)) ||
    (next.reverting && !sameList(next.reverting, state.reverting)) ||
    (next.hidden && next.hidden !== state.hidden);
  return changed ? { ...state, ...next } : state;
};

export const changesViewReducer = (
  state: ChangesViewState,
  action: ChangesViewAction,
): ChangesViewState => {
  switch (action.type) {
    case "toggle":
      return withChanges(state, {
        expanded: state.expanded.includes(action.path)
          ? state.expanded.filter((path) => path !== action.path)
          : [...state.expanded, action.path],
      });

    case "expand-all":
      return withChanges(state, { expanded: [...action.paths] });

    case "collapse-all":
      return withChanges(state, { expanded: [] });

    case "force-render":
      return state.forced.includes(action.path)
        ? state
        : withChanges(state, { forced: [...state.forced, action.path] });

    case "revert-started": {
      const paths = new Set(action.paths);
      const hidden = { ...state.hidden };
      for (const path of paths) hidden[path] = null;
      return withChanges(state, {
        expanded: state.expanded.filter((path) => !paths.has(path)),
        forced: state.forced.filter((path) => !paths.has(path)),
        hidden,
        reverting: [
          ...state.reverting.filter((path) => !paths.has(path)),
          ...paths,
        ],
      });
    }

    case "revert-finished": {
      const paths = new Set(action.paths);
      const hidden = { ...state.hidden };
      for (const path of paths) {
        if (action.succeeded) hidden[path] = action.version;
        else delete hidden[path];
      }
      return withChanges(state, {
        hidden,
        reverting: state.reverting.filter((path) => !paths.has(path)),
      });
    }

    case "status": {
      const changed = new Set(action.paths);
      let hidden = state.hidden;
      for (const [path, until] of Object.entries(state.hidden)) {
        if (until !== null && until <= action.version) {
          if (hidden === state.hidden) hidden = { ...state.hidden };
          delete (hidden as Record<string, number | null>)[path];
        }
      }
      return withChanges(state, {
        expanded: state.expanded.filter((path) => changed.has(path)),
        forced: state.forced.filter((path) => changed.has(path)),
        hidden,
      });
    }
  }
};

/** The changes the tab lists: all but those hidden by a revert. */
export const visibleChanges = <Change extends { path: string }>(
  state: ChangesViewState,
  changes: readonly Change[],
): Change[] => changes.filter((change) => !(change.path in state.hidden));
