import assert from "node:assert/strict";
import { test } from "vitest";
import {
  EMPTY_FILE_TABS,
  type FileTabsAction,
  type FileTabsState,
  fileTabsReducer,
} from "./file-tabs";

const reduce = (
  actions: FileTabsAction[],
  initial: FileTabsState = EMPTY_FILE_TABS,
) => actions.reduce(fileTabsReducer, initial);

test("preview opens a single unpinned tab and activates it", () => {
  const state = reduce([{ type: "preview", path: "a.ts" }]);
  assert.deepEqual(state, {
    activePath: "a.ts",
    tabs: [{ path: "a.ts", pinned: false }],
  });
});

test("previewing another file replaces the preview tab", () => {
  const state = reduce([
    { type: "preview", path: "a.ts" },
    { type: "preview", path: "b.ts" },
  ]);
  assert.deepEqual(state.tabs, [{ path: "b.ts", pinned: false }]);
  assert.equal(state.activePath, "b.ts");
});

test("pinning keeps the tab when the next file is previewed", () => {
  const state = reduce([
    { type: "pin", path: "a.ts" },
    { type: "preview", path: "b.ts" },
    { type: "preview", path: "c.ts" },
  ]);
  assert.deepEqual(state.tabs, [
    { path: "a.ts", pinned: true },
    { path: "c.ts", pinned: false },
  ]);
  assert.equal(state.activePath, "c.ts");
});

test("double-clicking a previewed file pins it in place", () => {
  const state = reduce([
    { type: "pin", path: "a.ts" },
    { type: "preview", path: "b.ts" },
    { type: "pin", path: "b.ts" },
    { type: "preview", path: "c.ts" },
  ]);
  assert.deepEqual(state.tabs, [
    { path: "a.ts", pinned: true },
    { path: "b.ts", pinned: true },
    { path: "c.ts", pinned: false },
  ]);
});

test("previewing an already pinned file activates it without opening a new tab", () => {
  const state = reduce([
    { type: "pin", path: "a.ts" },
    { type: "preview", path: "b.ts" },
    { type: "preview", path: "a.ts" },
  ]);
  assert.equal(state.tabs.length, 2);
  assert.equal(state.activePath, "a.ts");
  assert.deepEqual(state.tabs[1], { path: "b.ts", pinned: false });
});

test("closing the active tab activates the tab to its right, then left", () => {
  const base: FileTabsAction[] = [
    { type: "pin", path: "a.ts" },
    { type: "pin", path: "b.ts" },
    { type: "pin", path: "c.ts" },
    { type: "activate", path: "b.ts" },
  ];

  const afterMiddle = reduce([...base, { type: "close", path: "b.ts" }]);
  assert.equal(afterMiddle.activePath, "c.ts");

  const afterLast = reduce([
    ...base,
    { type: "activate", path: "c.ts" },
    { type: "close", path: "c.ts" },
  ]);
  assert.equal(afterLast.activePath, "b.ts");
});

test("closing an inactive tab keeps the active tab", () => {
  const state = reduce([
    { type: "pin", path: "a.ts" },
    { type: "pin", path: "b.ts" },
    { type: "close", path: "a.ts" },
  ]);
  assert.equal(state.activePath, "b.ts");
  assert.deepEqual(state.tabs, [{ path: "b.ts", pinned: true }]);
});

test("closing the last tab clears the active path", () => {
  const state = reduce([
    { type: "preview", path: "a.ts" },
    { type: "close", path: "a.ts" },
  ]);
  assert.deepEqual(state, { activePath: null, tabs: [] });
});

test("reorder moves tabs without changing the active path", () => {
  const state = reduce([
    { type: "pin", path: "a.ts" },
    { type: "pin", path: "b.ts" },
    { type: "pin", path: "c.ts" },
    { type: "reorder", fromIndex: 0, toIndex: 2 },
  ]);
  assert.deepEqual(
    state.tabs.map((tab) => tab.path),
    ["b.ts", "c.ts", "a.ts"],
  );
  assert.equal(state.activePath, "c.ts");
});

test("no-op actions return the same state reference", () => {
  const initial = reduce([{ type: "pin", path: "a.ts" }]);
  assert.equal(
    fileTabsReducer(initial, { type: "pin", path: "a.ts" }),
    initial,
  );
  assert.equal(
    fileTabsReducer(initial, { type: "close", path: "zzz.ts" }),
    initial,
  );
  assert.equal(
    fileTabsReducer(initial, { type: "activate", path: "zzz.ts" }),
    initial,
  );
});
