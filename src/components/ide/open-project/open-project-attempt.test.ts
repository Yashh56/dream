import { expect, test, vi } from "vitest";
import { createOpenProjectAttempt } from "./open-project-attempt";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, reject, resolve };
};

test("cancelling a delayed typed open retires its folder result", async () => {
  const folder = deferred<string>();
  const resolveFolder = vi.fn(
    (_host: string, _path: string, _signal: AbortSignal) => folder.promise,
  );
  const openProject = vi.fn(async () => true);
  const attempt = createOpenProjectAttempt({
    connect: async () => true,
    resolveFolder,
    pickFolder: async () => null,
    openProject,
  });
  const pending = attempt.typed("local", "~/old");
  await Promise.resolve();
  const signal = resolveFolder.mock.calls[0]?.[2];
  attempt.cancel();
  folder.resolve("/home/me/old");
  expect(await pending).toEqual({ status: "cancelled" });
  expect(signal?.aborted).toBe(true);
  expect(openProject).not.toHaveBeenCalled();
});

test("a newer Host and path supersede an older resolution", async () => {
  const oldFolder = deferred<string>();
  const openProject = vi.fn(async () => true);
  const attempt = createOpenProjectAttempt({
    connect: async () => true,
    resolveFolder: async (hostId) =>
      hostId === "host-a" ? oldFolder.promise : "/new",
    pickFolder: async () => null,
    openProject,
  });
  const old = attempt.typed("host-a", "~/old");
  await Promise.resolve();
  const current = attempt.typed("host-b", "~/new");
  expect(await current).toEqual({ status: "opened" });
  oldFolder.resolve("/old");
  expect(await old).toEqual({ status: "cancelled" });
  expect(openProject).toHaveBeenCalledOnce();
  expect(openProject).toHaveBeenCalledWith(
    "host-b",
    "/new",
    expect.any(AbortSignal),
  );
});

test("a dismissed native picker cannot open its late selection", async () => {
  const picker = deferred<string | null>();
  const openProject = vi.fn(async () => true);
  const attempt = createOpenProjectAttempt({
    connect: async () => true,
    resolveFolder: async () => "/unused",
    pickFolder: () => picker.promise,
    openProject,
  });
  const pending = attempt.browse("local");
  attempt.cancel();
  picker.resolve("/late");
  expect(await pending).toEqual({ status: "cancelled" });
  expect(openProject).not.toHaveBeenCalled();
});

test("failed connections and directory reads can be retried", async () => {
  const connect = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const resolveFolder = vi
    .fn()
    .mockRejectedValueOnce(new Error("missing folder"))
    .mockResolvedValue("/ok");
  const openProject = vi.fn(async () => true);
  const attempt = createOpenProjectAttempt({
    connect,
    resolveFolder,
    pickFolder: async () => null,
    openProject,
  });
  expect(await attempt.typed("host", "~/ok")).toEqual({
    status: "unavailable",
  });
  expect(await attempt.typed("host", "~/ok")).toMatchObject({
    status: "failed",
    error: expect.any(Error),
  });
  expect(await attempt.typed("host", "~/ok")).toEqual({ status: "opened" });
  expect(openProject).toHaveBeenCalledOnce();
});

test("cancelling while the store is opening aborts its commit signal", async () => {
  const opening = deferred<boolean>();
  const openProject = vi.fn(
    (_host: string, _path: string, _signal: AbortSignal) => opening.promise,
  );
  const attempt = createOpenProjectAttempt({
    connect: async () => true,
    resolveFolder: async () => "/ok",
    pickFolder: async () => null,
    openProject,
  });
  const pending = attempt.typed("local", "/ok");
  await vi.waitFor(() => expect(openProject).toHaveBeenCalledOnce());
  const signal = openProject.mock.calls[0]?.[2];
  attempt.cancel();
  expect(signal?.aborted).toBe(true);
  opening.resolve(false);
  expect(await pending).toEqual({ status: "cancelled" });
});
