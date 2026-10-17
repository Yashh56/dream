import { expect, test } from "vitest";
import {
  type ChangesViewAction,
  type ChangesViewState,
  changesViewReducer,
  EMPTY_CHANGES_VIEW,
  visibleChanges,
} from "./changes-view";

const run = (
  actions: ChangesViewAction[],
  initial: ChangesViewState = EMPTY_CHANGES_VIEW,
) => actions.reduce(changesViewReducer, initial);

const changes = [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }];

test("a row toggles open and closed once per click", () => {
  const once = run([{ path: "a.ts", type: "toggle" }]);
  expect(once.expanded).toEqual(["a.ts"]);
  expect(
    changesViewReducer(once, { path: "a.ts", type: "toggle" }).expanded,
  ).toEqual([]);
});

test("expand all and collapse all", () => {
  const state = run([
    { paths: ["a.ts", "b.ts"], type: "expand-all" },
    { path: "b.ts", type: "force-render" },
  ]);
  expect(state.expanded).toEqual(["a.ts", "b.ts"]);
  expect(run([{ type: "collapse-all" }], state).expanded).toEqual([]);
});

test("a fresh status forgets expanded and forced files that are no longer changed", () => {
  const state = run([
    { paths: ["a.ts", "b.ts"], type: "expand-all" },
    { path: "b.ts", type: "force-render" },
    { paths: ["a.ts"], type: "status", version: 1 },
  ]);
  expect(state.expanded).toEqual(["a.ts"]);
  expect(state.forced).toEqual([]);
});

test("a reverted file hides at once and collapses", () => {
  const state = run([
    { paths: ["a.ts", "b.ts"], type: "expand-all" },
    { paths: ["a.ts"], type: "revert-started" },
  ]);
  expect(state.reverting).toEqual(["a.ts"]);
  expect(state.expanded).toEqual(["b.ts"]);
  expect(visibleChanges(state, changes).map((change) => change.path)).toEqual([
    "b.ts",
    "c.ts",
  ]);
});

test("a failed revert shows the file again", () => {
  const state = run([
    { paths: ["a.ts"], type: "revert-started" },
    { paths: ["a.ts"], succeeded: false, type: "revert-finished", version: 2 },
  ]);
  expect(state.reverting).toEqual([]);
  expect(visibleChanges(state, changes)).toHaveLength(3);
});

test("after a successful revert, only a status read after it decides whether the file shows", () => {
  const reverted = run([
    { paths: ["a.ts"], type: "revert-started" },
    { paths: ["a.ts"], succeeded: true, type: "revert-finished", version: 3 },
  ]);

  // A status from before the revert still lists the file: stays hidden.
  const stale = changesViewReducer(reverted, {
    paths: ["a.ts", "b.ts"],
    type: "status",
    version: 2,
  });
  expect(visibleChanges(stale, changes).map((change) => change.path)).toEqual([
    "b.ts",
    "c.ts",
  ]);

  // The status after the revert decides: here the revert did not take.
  const fresh = changesViewReducer(stale, {
    paths: ["a.ts", "b.ts"],
    type: "status",
    version: 3,
  });
  expect(visibleChanges(fresh, changes)).toHaveLength(3);
});

test("a status read while a revert runs keeps the file hidden", () => {
  const state = run([
    { paths: ["a.ts"], type: "revert-started" },
    { paths: ["b.ts"], type: "status", version: 9 },
  ]);
  expect(visibleChanges(state, changes).map((change) => change.path)).toEqual([
    "b.ts",
    "c.ts",
  ]);
});

test("actions that change nothing keep the state", () => {
  const state = run([{ path: "a.ts", type: "force-render" }]);
  expect(
    changesViewReducer(state, { path: "a.ts", type: "force-render" }),
  ).toBe(state);
  expect(
    changesViewReducer(EMPTY_CHANGES_VIEW, {
      paths: ["a.ts"],
      type: "status",
      version: 1,
    }),
  ).toBe(EMPTY_CHANGES_VIEW);
});
