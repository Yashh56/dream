// @ts-check
// ssh's questions (a password, a 2FA code, an unknown host key) asked in
// the window and answered back. Each question gets an id; it is sent to the
// renderer, and settles with the renderer's answer, or with null when the
// renderer declines it, nobody can be asked (no window), or nobody answers
// in time.

/**
 * @typedef {object} SshPrompt
 * @property {string} hostId
 * @property {string} kind
 * @property {string} message
 * @property {string} target
 */

/**
 * @param {object} options
 * @param {() => boolean} options.canAsk Whether a window can show it now.
 * @param {(prompt: SshPrompt & { promptId: number }) => void} options.send
 * @param {number} [options.timeoutMs]
 * @param {(callback: () => void, ms: number) => unknown} [options.setTimer]
 * @param {(handle: unknown) => void} [options.clearTimer]
 */
export const createSshPromptBroker = ({
  canAsk,
  send,
  timeoutMs = 5 * 60_000,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (handle) =>
    clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (handle)),
}) => {
  /** @type {Map<number, (answer: unknown) => void>} */
  const pending = new Map();
  let nextPromptId = 1;

  return {
    /**
     * Asks the window; settles with its answer, or null.
     * @param {SshPrompt} prompt
     * @returns {Promise<string | null>}
     */
    ask: ({ hostId, kind, message, target }) =>
      new Promise((resolve) => {
        if (!canAsk()) {
          resolve(null);
          return;
        }
        const promptId = nextPromptId++;
        const timer = setTimer(() => {
          pending.delete(promptId);
          resolve(null);
        }, timeoutMs);
        pending.set(promptId, (answer) => {
          clearTimer(timer);
          pending.delete(promptId);
          resolve(typeof answer === "string" ? answer : null);
        });
        send({ hostId, kind, message, promptId, target });
      }),

    /**
     * The window's answer to a prompt; anything but a string declines it.
     * An unknown or already settled prompt is ignored.
     * @param {unknown} promptId
     * @param {unknown} answer
     */
    answer: (promptId, answer) => {
      pending.get(/** @type {number} */ (promptId))?.(answer);
    },

    /** Prompts still waiting for an answer. */
    get pendingCount() {
      return pending.size;
    },
  };
};
