import { expect, test } from "vitest";
import {
  createTerminalCommandRefresh,
  TERMINAL_COMMAND_QUIET_MS,
  TERMINAL_COMMAND_WINDOW_MS,
} from "./terminal-command-refresh";

const createClock = () => {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    advance: (ms: number) => {
      time += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    clearTimer: (id: number) => timers.delete(id),
    now: () => time,
    setTimer: (callback: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: time + ms, callback });
      return id;
    },
  };
};

const setup = () => {
  const clock = createClock();
  let settled = 0;
  const refresh = createTerminalCommandRefresh({
    ...clock,
    onSettled: () => {
      settled += 1;
    },
  });
  return { clock, refresh, settled: () => settled };
};

test("a command is read once its output goes quiet", () => {
  const { clock, refresh, settled } = setup();
  refresh.input("git commit -m x");
  clock.advance(TERMINAL_COMMAND_QUIET_MS * 2);
  expect(settled()).toBe(0);

  refresh.input("\r");
  clock.advance(TERMINAL_COMMAND_QUIET_MS - 1);
  refresh.output();
  clock.advance(TERMINAL_COMMAND_QUIET_MS - 1);
  expect(settled()).toBe(0);
  clock.advance(1);
  expect(settled()).toBe(1);
});

test("output with no command, or long after one, reads nothing", () => {
  const { clock, refresh, settled } = setup();
  refresh.output();
  clock.advance(TERMINAL_COMMAND_QUIET_MS);
  expect(settled()).toBe(0);

  refresh.input("\r");
  clock.advance(TERMINAL_COMMAND_QUIET_MS);
  expect(settled()).toBe(1);
  clock.advance(TERMINAL_COMMAND_WINDOW_MS);
  refresh.output();
  clock.advance(TERMINAL_COMMAND_QUIET_MS);
  expect(settled()).toBe(1);
});

test("disposing cancels a pending read", () => {
  const { clock, refresh, settled } = setup();
  refresh.input("\r");
  refresh.dispose();
  clock.advance(TERMINAL_COMMAND_QUIET_MS);
  expect(settled()).toBe(0);
});
