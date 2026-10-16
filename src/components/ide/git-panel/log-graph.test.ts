import assert from "node:assert/strict";
import { test } from "vitest";
import { buildGitGraph } from "./log-graph";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

test("a straight history stays in one lane", () => {
  const graph = buildGitGraph([c("c", "b"), c("b", "a"), c("a")]);

  assert.equal(graph.laneCount, 1);
  assert.deepEqual(graph.rows, [
    {
      column: 0,
      incoming: [],
      merge: false,
      outgoing: [0],
      passing: [],
      shifting: [],
    },
    {
      column: 0,
      incoming: [0],
      merge: false,
      outgoing: [0],
      passing: [],
      shifting: [],
    },
    {
      column: 0,
      incoming: [0],
      merge: false,
      outgoing: [],
      passing: [],
      shifting: [],
    },
  ]);
});

test("a merged branch's lane closes at its last commit", () => {
  // Topological order: m merges f (feature) into w (main); both forked
  // from a, which w's line is already waiting for when f is drawn.
  const graph = buildGitGraph([
    c("m", "w", "f"),
    c("f", "a"),
    c("w", "a"),
    c("a"),
  ]);

  assert.equal(graph.laneCount, 2);
  const [merge, feature, main, base] = graph.rows;
  assert.deepEqual(merge.outgoing, [0, 1]);
  assert.equal(merge.merge, true);
  assert.deepEqual(feature, {
    column: 1,
    incoming: [1],
    merge: false,
    outgoing: [1],
    passing: [0],
    shifting: [],
  });
  // f's lane waits for a; when w (further left) wants a too, f's line
  // moves over into w's lane.
  assert.deepEqual(main, {
    column: 0,
    incoming: [0],
    merge: false,
    outgoing: [0],
    passing: [],
    shifting: [{ from: 1, to: 0 }],
  });
  assert.deepEqual(base.incoming, [0]);
});

test("a line whose parent a lane to its left awaits joins that lane", () => {
  // x and y are tips with the same parent p; y joins x's lane at once.
  const graph = buildGitGraph([c("x", "p"), c("y", "p"), c("p")]);

  assert.deepEqual(graph.rows[1], {
    column: 1,
    incoming: [],
    merge: false,
    outgoing: [0],
    passing: [0],
    shifting: [],
  });
  assert.deepEqual(graph.rows[2].incoming, [0]);
  assert.equal(graph.laneCount, 2);
});

test("a freed lane is reused by the next tip", () => {
  const graph = buildGitGraph([
    c("x", "x0"),
    c("y"),
    c("z", "z0"),
    c("z0"),
    c("x0"),
  ]);

  assert.deepEqual(
    graph.rows.map((row) => row.column),
    [0, 1, 1, 1, 0],
  );
  assert.equal(graph.laneCount, 2);
});

test("a merge parent another lane already waits for joins that lane", () => {
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

test("many merged branches forked from one old commit stay narrow", () => {
  // Each merge brings in a one-commit branch forked from the root r. Their
  // lines to r join into one lane: main, that lane and the open branch.
  const mergedBranches = (count: number) => {
    const commits = [];
    for (let index = count; index > 0; index -= 1) {
      commits.push(c(`m${index}`, `m${index - 1}`, `b${index}`));
      commits.push(c(`b${index}`, "r"));
    }
    commits.push(c("m0", "r"), c("r"));
    return buildGitGraph(commits).laneCount;
  };

  assert.equal(mergedBranches(3), 3);
  assert.equal(mergedBranches(30), 3);
});

test("lines to parents beyond the loaded page run off the bottom", () => {
  const graph = buildGitGraph([c("m", "a", "b")]);

  assert.deepEqual(graph.rows[0].outgoing, [0, 1]);
  assert.equal(graph.laneCount, 2);
});
