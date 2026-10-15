// Turns on the host, over the chat routes: they outlive their client, can be
// followed again from the start, run one at a time per chat, stop only when
// told, and are saved to the catalog as they run.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, test, vi } from "vitest";

const gate = vi.hoisted(() => ({ release: null, signal: null, steps: null }));

vi.mock("./providers/registry.js", async () => {
  const { streamAgentTurn } = await import("./chat/agent-turn.js");
  return {
    getProvider: () => ({
      browserMcpScope: null,
      checkReady: async () => null,
      stream: ({ abortSignal, messages, responseMessageMetadata }) =>
        streamAgentTurn({
          abortSignal,
          execute: async (turn) => {
            gate.signal = abortSignal;
            if (gate.steps) {
              // A provider whose turn runs in steps (as Claude's does).
              const steps = gate.steps;
              turn.merge(
                new ReadableStream({
                  start(controller) {
                    steps.forEach((text, index) => {
                      const id = `s${index}`;
                      controller.enqueue({ type: "start-step" });
                      controller.enqueue({ id, type: "text-start" });
                      controller.enqueue({
                        delta: text,
                        id,
                        type: "text-delta",
                      });
                      controller.enqueue({ id, type: "text-end" });
                      controller.enqueue({ type: "finish-step" });
                    });
                    controller.close();
                  },
                }),
              );
              return;
            }
            turn.text("Working", "t1");
            turn.endText("t1");
            await new Promise((resolve) => {
              gate.release = resolve;
              abortSignal?.addEventListener("abort", resolve, { once: true });
            });
            turn.session("session-42");
            turn.text(" done.", "t2");
          },
          label: "Test",
          messages,
          model: "m",
          projectPath: "/p",
          provider: "openai",
          responseMessageMetadata,
        }),
    }),
  };
});

const { createTurnRegistry } = await import("./chat/turn-registry.js");
const { createTurnRecorder, registerChatRoutes } = await import(
  "./chat-routes.js"
);
const { createHostCatalog } = await import("../host/catalog.js");
const { configureHostDataDirectory } = await import("../host/host-paths.js");
const persisted = await import("../persisted-state.js");

let directory = null;
let turns = null;
// Writes the host started; a turn's last ones land after it stops running.
const pendingWrites = new Set();
const trackWrite = (write) => {
  const promise = Promise.resolve().then(write);
  pendingWrites.add(promise);
  promise.then(
    () => pendingWrites.delete(promise),
    () => pendingWrites.delete(promise),
  );
  return promise;
};

afterEach(async () => {
  gate.release?.();
  gate.release = null;
  gate.signal = null;
  gate.steps = null;
  // A write after the database closes would reopen it and keep it locked.
  if (turns) await waitFor(() => !turns.isRunning("c1"));
  await waitFor(() => pendingWrites.size === 0);
  turns = null;
  persisted.closePersistedStateDatabase();
  // Windows can hold the database file for a moment after it is closed.
  if (directory) {
    await rm(directory, { force: true, maxRetries: 5, recursive: true });
  }
  directory = null;
});

const setup = async () => {
  directory = await mkdtemp(path.join(tmpdir(), "dream-turns-"));
  configureHostDataDirectory(directory);
  const events = [];
  const saves = [];
  const catalog = createHostCatalog({
    events: { publish: (event) => events.push(event) },
    getWriter: () => ({
      applyCatalogChanges: (changes) =>
        trackWrite(() => persisted.applyPersistedCatalogChanges(changes)),
      saveChatMessages: (payload) => {
        saves.push(payload);
        return trackWrite(() => persisted.savePersistedChatMessages(payload));
      },
    }),
  });
  await catalog.applyChanges({
    chats: [{ id: "c1", projectId: "p1", title: "Chat" }],
    projects: [{ id: "p1", path: directory }],
  });
  turns = createTurnRegistry();
  const app = new Hono();
  registerChatRoutes(app, { catalog, turns });

  const startTurn = (
    messages = [
      { id: "u1", parts: [{ text: "Go", type: "text" }], role: "user" },
    ],
  ) =>
    app.request("/api/chat", {
      body: JSON.stringify({
        chatId: "c1",
        checkpointsEnabled: false,
        messages,
        model: "m",
        projectPath: directory,
        provider: "openai",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  return { app, catalog, events, saves, startTurn, turns };
};

const transcriptOf = async (catalog, chatId) =>
  JSON.parse(await catalog.getTranscriptJson(chatId));

const waitFor = async (check) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting.");
};

test("a turn outlives its client and is saved, provider session included", async () => {
  const { catalog, startTurn, turns } = await setup();

  const response = await startTurn();
  assert.equal(response.status, 200);
  // The client goes away mid-turn.
  await response.body.cancel();
  await waitFor(() => gate.release !== null);
  gate.release();
  await waitFor(() => !turns.isRunning("c1"));

  // Saved by the host, the client's own request first.
  await waitFor(async () => {
    const transcript = await transcriptOf(catalog, "c1");
    return transcript.length === 2 && transcript[1].role === "assistant";
  });
  const [user, assistant] = await transcriptOf(catalog, "c1");
  assert.equal(user.id, "u1");
  assert.match(
    assistant.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
    /Working done\./,
  );
  await waitFor(
    async () =>
      (await catalog.getChat("c1"))?.remoteConversationId === "session-42",
  );
});

test("a reconnecting client follows the running turn from its start", async () => {
  const { app, startTurn } = await setup();
  const response = await startTurn();
  await response.body.cancel();
  await waitFor(() => gate.release !== null);

  const resumed = await app.request("/api/chat/c1/stream");
  gate.release();
  const text = await resumed.text();

  assert.equal(resumed.status, 200);
  assert.match(text, /Working/);
  assert.match(text, /done\./);
  assert.equal((await app.request("/api/chat/c1/stream")).status, 204);
});

test("a second turn in the same chat is refused while one runs", async () => {
  const { startTurn } = await setup();
  const first = await startTurn();
  await waitFor(() => gate.release !== null);

  const second = await startTurn();

  assert.equal(second.status, 409);
  gate.release();
  await first.text();
});

test("only the stop route ends a turn early", async () => {
  const { app, startTurn, turns } = await setup();
  const response = await startTurn();
  await response.body.cancel();
  await waitFor(() => gate.signal !== null);
  assert.equal(gate.signal.aborted, false);

  const stopped = await app.request("/api/chat/stop", {
    body: JSON.stringify({ chatId: "c1" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  assert.deepEqual(await stopped.json(), { stopped: true });
  assert.equal(gate.signal.aborted, true);
  await waitFor(() => !turns.isRunning("c1"));
});

test("a turn saves the request once, then only the message it is writing", async () => {
  const { catalog, events, saves, startTurn, turns } = await setup();
  gate.steps = ["One.", " Two.", " Three."];
  const request = [
    { id: "u1", parts: [{ text: "Hi", type: "text" }], role: "user" },
    { id: "a1", parts: [{ text: "Hello", type: "text" }], role: "assistant" },
    { id: "u2", parts: [{ text: "Go", type: "text" }], role: "user" },
  ];

  const response = await startTurn(request);
  await response.text();
  await waitFor(() => !turns.isRunning("c1"));
  await waitFor(async () => {
    const text = (await transcriptOf(catalog, "c1"))
      .at(-1)
      ?.parts.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    return text === "One. Two. Three.";
  });

  // More than one save, and only the first carries the request.
  assert.ok(saves.length > 1);
  const [first, ...rest] = saves;
  assert.equal(first.fromIndex ?? 0, 0);
  assert.deepEqual(
    first.messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  );
  for (const save of rest) {
    assert.equal(save.fromIndex, 3);
    assert.equal(save.messages.length, 1);
    assert.equal(save.messages[0].role, "assistant");
  }

  assert.deepEqual(
    (await transcriptOf(catalog, "c1"))
      .map((message) => message.id)
      .slice(0, 3),
    ["u1", "a1", "u2"],
  );
  // Clients are told the whole transcript's length either way.
  assert.ok(
    events
      .filter((event) => event.kind === "transcript")
      .every((event) => event.messageCount === 4),
  );
});

test("steps saved closer together than the interval are held; the end is saved at once", async () => {
  const saves = [];
  const recorder = createTurnRecorder({
    catalog: {
      getChat: async () => null,
      saveTranscript: async (_chatId, messages, options) => {
        saves.push({
          fromIndex: options.fromIndex ?? 0,
          ids: messages.map((m) => m.id),
        });
        return true;
      },
    },
    chatId: "c1",
    projectPath: "/p",
    requestMessages: [{ id: "u1", parts: [], role: "user" }],
    saveIntervalMs: 200,
  });
  const step = (id) => ({ id, parts: [], role: "assistant" });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // The first step is saved at once, with the request.
  await recorder.onMessage(step("s1"), { final: false });
  // The next two come too soon: held, and only the later one is saved.
  await recorder.onMessage(step("s2"), { final: false });
  await recorder.onMessage(step("s3"), { final: false });
  assert.equal(saves.length, 1);
  await waitFor(() => saves.length === 2);
  assert.deepEqual(saves, [
    { fromIndex: 0, ids: ["u1", "s1"] },
    { fromIndex: 1, ids: ["s3"] },
  ]);

  // Once the interval has passed a step is saved at once again. A held
  // step is dropped when the end arrives first, and never lands after it.
  await sleep(250);
  await recorder.onMessage(step("s4"), { final: false });
  await recorder.onMessage(step("s5"), { final: false });
  await recorder.onMessage(step("end"), { final: true });
  await sleep(250);
  assert.deepEqual(saves.slice(2), [
    { fromIndex: 1, ids: ["s4"] },
    { fromIndex: 1, ids: ["end"] },
  ]);
});
