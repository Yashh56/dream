import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createRendererUnloadGuard,
  getReloadShortcutOptions,
} from "./renderer-unload-guard.js";

const createProcesses = ({ active = true, fail = false } = {}) => {
  const log = [];
  let release;
  return {
    finish: () => release?.(),
    log,
    processes: {
      hasActiveSessions: () => active,
      stopAllProcesses: () => {
        log.push("stop");
        return new Promise((resolve, reject) => {
          release = () => (fail ? reject(new Error("stuck")) : resolve());
        });
      },
    },
  };
};

const createWebContents = (log) => {
  let destroyed = false;
  return {
    destroy: () => {
      destroyed = true;
    },
    isDestroyed: () => destroyed,
    reload: () => log.push("reload"),
    reloadIgnoringCache: () => log.push("reload ignoring cache"),
  };
};

test("a reload waits for processes to stop, and joins one under way", async () => {
  const { finish, log, processes } = createProcesses();
  const guard = createRendererUnloadGuard({ processes });
  const contents = createWebContents(log);

  const first = guard.reload(contents, { ignoreCache: true });
  const second = guard.reload(contents);
  assert.equal(first, second);
  await Promise.resolve();
  assert.deepEqual(log, ["stop"]);
  finish();
  await first;
  assert.deepEqual(log, ["stop", "reload ignoring cache"]);
});

test("a page destroyed while processes stop is not reloaded", async () => {
  const { finish, log, processes } = createProcesses();
  const guard = createRendererUnloadGuard({ processes });
  const contents = createWebContents(log);
  const reloading = guard.reload(contents);
  contents.destroy();
  finish();
  await reloading;
  assert.deepEqual(log, ["stop"]);
});

test("a navigation is held only while processes run", async () => {
  const idle = createRendererUnloadGuard({
    processes: createProcesses({ active: false }).processes,
  });
  assert.equal(
    idle.holdNavigation(() => {}),
    false,
  );

  const { finish, log, processes } = createProcesses();
  const guard = createRendererUnloadGuard({ processes });
  assert.equal(
    guard.holdNavigation(() => log.push("navigate")),
    true,
  );
  finish();
  await guard.stopProcesses();
  await Promise.resolve();
  assert.deepEqual(log, ["stop", "navigate"]);
});

test("a failed stop is reported, never thrown, and the next stop runs again", async () => {
  const errors = [];
  const { finish, log, processes } = createProcesses({ fail: true });
  const guard = createRendererUnloadGuard({
    onError: (message) => errors.push(message),
    processes,
  });
  const stopping = guard.stopProcesses();
  assert.equal(guard.stopProcesses(), stopping);
  finish();
  await stopping;
  assert.equal(errors.length, 1);
  void guard.stopProcesses();
  assert.deepEqual(log, ["stop", "stop"]);
});

test("reload shortcuts", () => {
  const key = (key, modifiers = {}) => ({ key, type: "keyDown", ...modifiers });
  assert.deepEqual(getReloadShortcutOptions(key("F5")), { ignoreCache: false });
  assert.deepEqual(getReloadShortcutOptions(key("F5", { control: true })), {
    ignoreCache: true,
  });
  assert.deepEqual(getReloadShortcutOptions(key("r", { meta: true })), {
    ignoreCache: false,
  });
  assert.deepEqual(
    getReloadShortcutOptions(key("R", { control: true, shift: true })),
    { ignoreCache: true },
  );
  assert.equal(getReloadShortcutOptions(key("r")), null);
  assert.equal(
    getReloadShortcutOptions(key("r", { control: true, isAutoRepeat: true })),
    null,
  );
  assert.equal(getReloadShortcutOptions({ ...key("F5"), type: "keyUp" }), null);
});
