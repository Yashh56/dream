import { expect, test } from "vitest";
import { watchWindowReturn } from "./window-return";

const createTarget = () => {
  const listeners = new Map<string, () => void>();
  const target = {
    document: {
      activeElement: null as { tagName: string } | null,
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(`document:${type}`, listener),
      removeEventListener: (type: string) =>
        listeners.delete(`document:${type}`),
    },
    window: {
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(`window:${type}`, listener),
      removeEventListener: (type: string) => listeners.delete(`window:${type}`),
    },
  };
  const fire = (name: string) => listeners.get(name)?.();
  return { fire, listeners, target };
};

const watch = (target: ReturnType<typeof createTarget>["target"]) => {
  let returns = 0;
  const stop = watchWindowReturn(
    () => {
      returns += 1;
    },
    target as unknown as Parameters<typeof watchWindowReturn>[1],
  );
  return { returns: () => returns, stop };
};

test("coming back from another app or tab counts once", () => {
  const { fire, target } = createTarget();
  const watcher = watch(target);
  fire("window:focus");
  expect(watcher.returns()).toBe(0);

  fire("window:blur");
  fire("window:focus");
  expect(watcher.returns()).toBe(1);

  // Hidden, then shown and focused: one return, not two.
  target.document.visibilityState = "hidden";
  fire("document:visibilitychange");
  target.document.visibilityState = "visible";
  fire("document:visibilitychange");
  fire("window:focus");
  expect(watcher.returns()).toBe(2);
});

test("focus moving into the window's own webview is not leaving", () => {
  const { fire, target } = createTarget();
  const watcher = watch(target);
  target.document.activeElement = { tagName: "WEBVIEW" };
  fire("window:blur");
  target.document.activeElement = null;
  fire("window:focus");
  expect(watcher.returns()).toBe(0);
});

test("stopping removes every listener", () => {
  const { listeners, target } = createTarget();
  const watcher = watch(target);
  watcher.stop();
  expect(listeners.size).toBe(0);
});
