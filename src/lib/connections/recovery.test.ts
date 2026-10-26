import { afterEach, expect, test, vi } from "vitest";
import { createFakeHostSocket } from "../host-socket-fake";
import type { RecoveryWorkspace } from "./recovery";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});
const setup = () => {
  const fake = createFakeHostSocket();
  cleanups.push(() => {
    fake.socket.dispose();
    fake.recovery.dispose();
  });
  return fake;
};
const workspace = (): RecoveryWorkspace => ({
  hosts: () => ["local"],
  isLoaded: () => true,
  catalogs: {
    suspend: vi.fn(),
    resume: vi.fn(),
    refresh: vi.fn(async () => {}),
  },
  reattach: vi.fn(),
});
const online = { reason: "online" as const, hiddenMs: 0 };

test("refusal blocks retain, send, connect, resume and a scheduled retry", async () => {
  const { api, socket, transports, timers, flush, supervisor, recovery } =
    setup();
  socket.retain();
  await flush();
  transports[0].open();
  transports[0].close();
  expect(timers).toHaveLength(1);
  supervisor.set("local", "unauthorized");
  api.hostSocketTicket.mockClear();
  socket.retain();
  socket.connect();
  socket.reconnect();
  socket.send(
    { channel: "terminal", type: "input", data: "old" },
    { replay: false },
  );
  timers[0]();
  await recovery.resume(online);
  await flush();
  expect(api.hostSocketTicket).not.toHaveBeenCalled();
  supervisor.clear("local");
  supervisor.set("local", "ready");
  await flush();
  transports[1].open();
  expect(transports[1].sent).toEqual([
    { channel: "host", type: "resume", cursors: {} },
  ]);
});

test("replacement ignores delayed tickets and old socket messages", async () => {
  const { api, socket, transports, flush, recovery } = setup();
  const first = deferred<{ ticket: string }>();
  api.hostSocketTicket.mockImplementationOnce(() => first.promise);
  const receive = vi.fn();
  socket.register({ name: "catalog", cursor: () => 7, receive });
  socket.retain();
  await recovery.resume(online);
  await flush();
  expect(transports).toHaveLength(1);
  first.resolve({ ticket: "old" });
  await flush();
  expect(transports).toHaveLength(1);
  transports[0].open();
  expect(transports[0].sent[0]).toMatchObject({ cursors: { catalog: 7 } });
  await recovery.resume(online);
  await flush();
  transports[0].deliver({ channel: "catalog", type: "old" });
  transports[1].open();
  transports[1].deliver({ channel: "catalog", type: "fresh" });
  expect(receive.mock.calls).toEqual([[{ channel: "catalog", type: "fresh" }]]);
});

test("only the latest accepted catalog resumes that host's chat observers", async () => {
  const { recovery, flush } = setup();
  const target = workspace();
  const first = deferred<void>();
  const second = deferred<void>();
  vi.mocked(target.catalogs.refresh)
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  recovery.bindWorkspace(target);
  const old = recovery.resume(online);
  await flush();
  const fresh = recovery.resume(online);
  await flush();
  second.resolve();
  await fresh;
  expect(target.reattach).toHaveBeenCalledExactlyOnceWith("local");
  first.resolve();
  await old;
  expect(target.reattach).toHaveBeenCalledTimes(1);
  expect(target.catalogs.suspend).toHaveBeenCalledTimes(2);
});

test("a short foreground keeps the catalog and a long one replaces it", async () => {
  const { recovery } = setup();
  const target = workspace();
  recovery.bindWorkspace(target);
  await recovery.resume({ reason: "foreground", hiddenMs: 100 });
  expect(target.catalogs.refresh).not.toHaveBeenCalled();
  await recovery.resume({ reason: "foreground", hiddenMs: 15_000 });
  expect(target.catalogs.refresh).toHaveBeenCalledExactlyOnceWith("local");
  expect(target.reattach).toHaveBeenCalledExactlyOnceWith("local");
});

test("a home probe refusing the client stops socket, catalog and observation recovery", async () => {
  const { api, socket, supervisor, recovery, flush } = setup();
  const target = workspace();
  recovery.bindWorkspace(target);
  recovery.start({
    lifecycle: { onOnline: () => () => {}, onForeground: () => () => {} },
    probeHome: async () => {
      supervisor.set("local", "unauthorized");
    },
  });
  socket.retain();
  await recovery.resume(online);
  await flush();
  expect(api.hostSocketTicket).not.toHaveBeenCalled();
  expect(target.catalogs.refresh).not.toHaveBeenCalled();
  expect(target.reattach).not.toHaveBeenCalled();
});

test("refusal during a read prevents reattachment; readiness reloads cached data", async () => {
  const { recovery, supervisor, flush } = setup();
  const target = workspace();
  const pending = deferred<void>();
  vi.mocked(target.catalogs.refresh).mockImplementationOnce(
    () => pending.promise,
  );
  recovery.bindWorkspace(target);
  const resuming = recovery.resume(online);
  await flush();
  supervisor.set("local", "incompatible");
  pending.resolve();
  await resuming;
  expect(target.reattach).not.toHaveBeenCalled();
  supervisor.clear("local");
  supervisor.set("local", "ready");
  await flush();
  expect(target.catalogs.refresh).toHaveBeenCalledTimes(2);
  expect(target.reattach).toHaveBeenCalledExactlyOnceWith("local");
});

test("terminal input expired during suspension is not replayed", async () => {
  const { socket, transports, flush, recovery } = setup();
  const now = vi.spyOn(Date, "now").mockReturnValue(0);
  socket.retain();
  socket.send(
    { channel: "terminal", type: "input", data: "old" },
    { replay: false },
  );
  await flush();
  now.mockReturnValue(5_001);
  await recovery.resume(online);
  await flush();
  transports.at(-1)?.open();
  expect(transports.at(-1)?.sent).toEqual([
    { channel: "host", type: "resume", cursors: {} },
  ]);
});
