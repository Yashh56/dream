import assert from "node:assert/strict";
import { test } from "vitest";
import { createSshPromptBroker } from "./prompt-broker.js";

const prompt = {
  hostId: "h",
  kind: "password",
  message: "Password:",
  target: "box",
};

const createBroker = ({ canAsk = true } = {}) => {
  const sent = [];
  const timers = new Map();
  const broker = createSshPromptBroker({
    canAsk: () => canAsk,
    clearTimer: (handle) => timers.delete(handle),
    send: (message) => sent.push(message),
    setTimer: (callback) => {
      const handle = Symbol("timer");
      timers.set(handle, callback);
      return handle;
    },
  });
  const expire = () => {
    for (const callback of [...timers.values()]) callback();
  };
  return { broker, expire, sent, timers };
};

test("a prompt is sent with an id and settles with the window's answer", async () => {
  const { broker, sent, timers } = createBroker();
  const first = broker.ask(prompt);
  const second = broker.ask(prompt);
  assert.deepEqual(
    sent.map((message) => message.promptId),
    [1, 2],
  );
  assert.deepEqual(sent[0], { ...prompt, promptId: 1 });

  broker.answer(2, "two");
  broker.answer(1, "one");
  assert.equal(await first, "one");
  assert.equal(await second, "two");
  assert.equal(timers.size, 0);
  assert.equal(broker.pendingCount, 0);
});

test("anything but a string declines; a late or unknown answer is ignored", async () => {
  const { broker } = createBroker();
  const asked = broker.ask(prompt);
  broker.answer(1, { not: "text" });
  broker.answer(1, "too late");
  broker.answer(99, "nobody asked");
  assert.equal(await asked, null);
});

test("with no window, or no answer in time, it settles with null", async () => {
  const closed = createBroker({ canAsk: false });
  assert.equal(await closed.broker.ask(prompt), null);
  assert.deepEqual(closed.sent, []);

  const { broker, expire } = createBroker();
  const asked = broker.ask(prompt);
  expire();
  assert.equal(await asked, null);
  assert.equal(broker.pendingCount, 0);
});
