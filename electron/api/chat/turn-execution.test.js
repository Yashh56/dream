import { expect, test, vi } from "vitest";
import { streamAgentTurn } from "./agent-turn.js";
import { executeAgentTurn } from "./turn-execution.js";
import { createTurnRegistry } from "./turn-registry.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const messages = [
  { id: "u", role: "user", parts: [{ type: "text", text: "Hi" }] },
];

test("completion holds the chat through final persistence and checkpoint finalization", async () => {
  const saving = deferred();
  const saved = deferred();
  const finalizing = deferred();
  const finalized = deferred();
  const turns = createTurnRegistry();
  let completed = false;
  const run = turns
    .run({
      chatId: "c",
      run: (abortSignal) =>
        executeAgentTurn(
          {
            chatId: "c",
            requestMessages: messages,
            catalog: {
              saveTranscript: async () => {
                saving.resolve();
                await saved.promise;
                return true;
              },
            },
            finalize: async () => {
              finalizing.resolve();
              await finalized.promise;
            },
          },
          () =>
            streamAgentTurn({
              provider: "openai",
              messages,
              abortSignal,
              execute: async (turn) => {
                turn.text("Answer");
              },
            }),
        ),
    })
    .then(() => {
      completed = true;
    });
  await saving.promise;
  expect(turns.isRunning("c")).toBe(true);
  expect(completed).toBe(false);
  saved.resolve();
  await finalizing.promise;
  expect(turns.isRunning("c")).toBe(true);
  expect(completed).toBe(false);
  finalized.resolve();
  await run;
  expect(turns.isRunning("c")).toBe(false);
});

test("failed persistence fails completion after the checkpoint settles", async () => {
  const finalize = vi.fn();
  const turns = createTurnRegistry();
  await expect(
    turns.run({
      chatId: "c",
      run: () =>
        executeAgentTurn(
          {
            chatId: "c",
            requestMessages: messages,
            finalize,
            catalog: {
              saveTranscript: async () => {
                throw new Error("Disk full");
              },
            },
          },
          () =>
            streamAgentTurn({
              provider: "openai",
              messages,
              execute: async (turn) => {
                turn.text("Answer");
              },
            }),
        ),
    }),
  ).rejects.toThrow("Disk full");
  expect(finalize).toHaveBeenCalledTimes(1);
  expect(turns.isRunning("c")).toBe(false);
});

test("disconnect does not finalize or abort; Stop settles output before finalization", async () => {
  const stopped = deferred();
  const finalized = deferred();
  const finalize = vi.fn(() => {
    finalized.resolve();
  });
  let signal;
  let saved;
  const turns = createTurnRegistry();
  const response = await turns.start({
    chatId: "c",
    run: (abortSignal) => {
      signal = abortSignal;
      return executeAgentTurn(
        {
          chatId: "c",
          requestMessages: messages,
          catalog: {
            saveTranscript: async (_id, next) => {
              saved = next;
              return true;
            },
          },
          finalize,
        },
        () =>
          streamAgentTurn({
            provider: "openai",
            messages,
            abortSignal,
            execute: async (turn) => {
              turn.text("Partial answer");
              await stopped.promise;
            },
          }),
      );
    },
  });
  await response.body.cancel();
  expect(signal.aborted).toBe(false);
  expect(finalize).not.toHaveBeenCalled();
  turns.stop("c");
  expect(signal.aborted).toBe(true);
  expect(finalize).not.toHaveBeenCalled();
  stopped.resolve();
  await finalized.promise;
  expect(saved.at(-1).metadata.completedAt).toBeTruthy();
  expect(finalize).toHaveBeenCalledTimes(1);
});

test("checkpoint failure is best effort and does not fail a saved turn", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const response = await executeAgentTurn(
      {
        finalize: async () => {
          throw new Error("Checkpoint unavailable");
        },
      },
      () => new Response("answer"),
    );
    expect(await response.text()).toBe("answer");
    expect(warning).toHaveBeenCalledTimes(1);
  } finally {
    warning.mockRestore();
  }
});

test("a failed provider launch still finalizes once and releases the chat", async () => {
  const finalize = vi.fn();
  const turns = createTurnRegistry();
  await expect(
    turns.run({
      chatId: "c",
      run: () =>
        executeAgentTurn({ finalize }, () => {
          throw new Error("Launch failed");
        }),
    }),
  ).rejects.toThrow("Launch failed");
  expect(finalize).toHaveBeenCalledTimes(1);
  expect(turns.isRunning("c")).toBe(false);
});
