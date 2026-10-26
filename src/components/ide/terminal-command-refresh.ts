/**
 * Refreshes a project's git state (and files) after a command typed in its
 * terminal: `git commit`, `git checkout` or a script there changes what the
 * Git panel shows, and nothing else would notice. A command is a line
 * entered with Enter; its effects are read once its output goes quiet.
 * Output long after the Enter (a dev server's logs) is not a command's.
 */

/** Output pauses this long before the command counts as done. */
export const TERMINAL_COMMAND_QUIET_MS = 750;
/** Output this long after Enter no longer belongs to the command. */
export const TERMINAL_COMMAND_WINDOW_MS = 30_000;

export const createTerminalCommandRefresh = ({
  now = () => Date.now(),
  onSettled,
  setTimer = (callback, ms) => window.setTimeout(callback, ms),
  clearTimer = (timer) => window.clearTimeout(timer),
}: {
  now?: () => number;
  onSettled: () => void;
  setTimer?: (callback: () => void, ms: number) => number;
  clearTimer?: (timer: number) => void;
}) => {
  let enteredAt: number | null = null;
  let timer: number | null = null;

  const schedule = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      onSettled();
    }, TERMINAL_COMMAND_QUIET_MS);
  };

  return {
    /** What the person typed, as sent to the shell. */
    input: (data: string) => {
      if (!data.includes("\r")) return;
      enteredAt = now();
      schedule();
    },
    /** The shell printed something. */
    output: () => {
      if (enteredAt === null) return;
      if (now() - enteredAt > TERMINAL_COMMAND_WINDOW_MS) {
        enteredAt = null;
        return;
      }
      schedule();
    },
    dispose: () => {
      if (timer !== null) clearTimer(timer);
      timer = null;
      enteredAt = null;
    },
  };
};
