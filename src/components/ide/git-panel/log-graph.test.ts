import assert from "node:assert/strict";
import { test } from "vitest";
import { buildGitGraph } from "./log-graph";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

test("a straight history stays in one lane", () => {
  const graph = buildGitGraph([c("c", "b"), c("b", "a"), c("a")]);

  assert.equal(graph.laneCount, 1);
  assert.deepEqual(graph.rows, [
    { column: 0, incoming: [], merge: false, outgoing: [0], passing: [] },
    { column: 0, incoming: [0], merge: false, outgoing: [0], passing: [] },
    { column: 0, incoming: [0], merge: false, outgoing: [], passing: [] },
  ]);
});

test("a merge opens a lane for its second parent, closed where it forked", () => {
  // m merges f (feature) into w (main); both forked from a.
  const graph = buildGitGraph([
    c("m", "w", "f"),
    c("w", "a"),
    c("f", "a"),
    c("a"),
  ]);

  assert.equal(graph.laneCount, 2);
  const [merge, mainWork, featureWork, base] = graph.rows;
  assert.deepEqual(merge, {
    column: 0,
    incoming: [],
    merge: true,
    outgoing: [0, 1],
    passing: [],
  });
  assert.deepEqual(mainWork, {
    column: 0,
    incoming: [0],
    merge: false,
    outgoing: [0],
    passing: [1],
  });
  assert.deepEqual(featureWork, {
    column: 1,
    incoming: [1],
    merge: false,
    outgoing: [1],
    passing: [0],
  });
  // Both lanes wait for a: they join at its node.
  assert.deepEqual(base, {
    column: 0,
    incoming: [0, 1],
    merge: false,
    outgoing: [],
    passing: [],
  });
});

test("a second branch tip takes a free lane, which is reused once freed", () => {
  // x and y are unrelated tips; y's lane ends at its root, and z (another
  // tip below it) takes that lane again.
  const graph = buildGitGraph([c("x", "x0"), c("y"), c("z", "x0"), c("x0")]);

  assert.deepEqual(
    graph.rows.map((row) => row.column),
    [0, 1, 1, 0],
  );
  assert.deepEqual(graph.rows[3].incoming, [0, 1]);
  assert.equal(graph.laneCount, 2);
});

test("a merge parent another lane already waits for joins that lane", () => {
  // m1 and m2 both merge in f; m2's line to f joins the lane m1 opened.
  const graph = buildGitGraph([
    c("m1", "m2", "f"),
    c("m2", "a", "f"),
    c("f", "a"),
    c("a"),
  ]);

  assert.deepEqual(graph.rows[1].outgoing, [0, 1]);
  assert.deepEqual(graph.rows[1].passing, [1]);
  assert.equal(graph.laneCount, 2);
});

test("lines to parents beyond the loaded page run off the bottom", () => {
  const graph = buildGitGraph([c("m", "a", "b")]);

  assert.deepEqual(graph.rows[0].outgoing, [0, 1]);
  assert.equal(graph.laneCount, 2);
});
