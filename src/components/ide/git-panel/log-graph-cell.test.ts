import assert from "node:assert/strict";
import { test } from "vitest";
import { getGitGraphLayout } from "./log-graph-cell";

test("a few lanes are drawn at full width", () => {
  assert.deepEqual(getGitGraphLayout(3), {
    clipped: false,
    laneWidth: 12,
    width: 44,
  });
  assert.equal(getGitGraphLayout(0).width, 20);
});

test("a busy graph narrows its lanes to fit before clipping", () => {
  // 23 lanes: umami's busiest stretch.
  assert.deepEqual(getGitGraphLayout(23), {
    clipped: false,
    laneWidth: 6,
    width: 146,
  });
});

test("past what fits at the narrowest lanes, the rest is clipped", () => {
  const layout = getGitGraphLayout(40);
  assert.equal(layout.laneWidth, 6);
  assert.equal(layout.clipped, true);
  assert.equal(layout.width, 8 + 26 * 6);
});
