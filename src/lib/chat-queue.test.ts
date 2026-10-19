import { expect, test } from "vitest";
import type { ChatRunSummary } from "./api-client";
import { visibleQueueRuns } from "./chat-queue";

const run = (id: string, status: ChatRunSummary["status"]): ChatRunSummary => ({
  chatId: "chat-1",
  error: null,
  id,
  model: "model",
  provider: "provider",
  status,
  text: id,
});

const ids = (runs: ChatRunSummary[]) => runs.map((entry) => entry.id);

test("the live turn alone is not a queue", () => {
  expect(visibleQueueRuns([run("a", "running")])).toEqual([]);
  expect(visibleQueueRuns([run("a", "waiting")])).toEqual([]);
  expect(
    visibleQueueRuns([run("a", "completed"), run("b", "running")]),
  ).toEqual([]);
});

test("finished runs are never listed", () => {
  expect(
    visibleQueueRuns([run("a", "completed"), run("b", "cancelled")]),
  ).toEqual([]);
});

test("a queued follow-up lists the live turn with it", () => {
  expect(
    ids(
      visibleQueueRuns([
        run("a", "completed"),
        run("b", "running"),
        run("c", "queued"),
      ]),
    ),
  ).toEqual(["b", "c"]);
});

test("interrupted and failed runs need attention", () => {
  expect(ids(visibleQueueRuns([run("a", "interrupted")]))).toEqual(["a"]);
  expect(ids(visibleQueueRuns([run("a", "failed")]))).toEqual(["a"]);
});
